import { take } from 'rxjs/operators'

const fs = require('fs')
const util = require('util')
const EventEmitter = require('events').EventEmitter
const suD = require('./')

function suDownloadItem(options) {
	util.inherits(suDownloadItem, EventEmitter)

	this.meta = {}

	this.status = 'NOT YET STARTED'
	
	this.options = {
		key: options.key,
		url: options.url,
		path: options.path,
		sudPath: suD.sudPath(options.path),
		retry: options.retry || 5
	}

	this.stats = {
		time: {
			start: 0,
			end: 0
		},
		total: {
			size: 0,
			downloaded: 0,
			completed: 0
		},
		past: {
			downloaded: 0
		},
		present: {
			deltaDownloaded: 0,
			downloaded: 0,
			time: 0,
			speed: 0,
			averageSpeed: 0
		},
		future: {
			remaining: 0,
			eta: 0
		}
	}

	this.start = () => {
		this.status = 'DOWNLOADING'
		let { sudPath, url } = this.options
		let dlPath = this.options.path
		fs.access(sudPath, err => {
			if(!err) this.downloadFromExisting()
			else { 
				suD.initiateDownload({ url, path: dlPath })
					.subscribe(x => {
						this.setMeta(x)
						this.downloadFromExisting()
					})
			}

			this.calculateStartTime()
		})
	}

	this.downloadFromExisting = () => {
		this.status = 'DOWNLOADING'
		let { sudPath, throttleRate } = this.options
		const meta$ = suD.startDownload(sudPath)

		meta$
			.pipe(take(1))
			.subscribe(
				x => {
					this.retried = 0
					this.setMeta(x)
					this.updateInterval = setInterval(this.handleProgress, throttleRate)
				},
				err => this.handleError(err)
			)

		this.progressSubscription = meta$
			.subscribe(
				response => {
					this.setMeta(response)
				},
				err => { 
					this.handleError(err)
				},
				() => this.handleFinishDownload()
			)

	}

	this.pause = () => {
		if(this.updateInterval) {
			clearInterval(this.updateInterval)
			this.updateInterval = null
		}
		this.status = 'PAUSED'
		this.emit('pause')
		if(this.progressSubscription) {
			this.progressSubscription.unsubscribe()
		}
	}

	this.restart = () => {
		this.pause()
		this.downloadFromExisting()
	}

	this.handleProgress = () => {
		this.calculateStats()
		this.emit('progress', this.stats)
	}

	//region STATS CALCULATION FUNCTIONS
	this.setMeta = meta => {
		let { filesize, threads, positions } = meta
		this.meta = { filesize, threads, positions }
	}

	this.calculateInitialStats = data => {
		let { filesize, threads, positions } = data
		this.meta = { filesize, threads, positions }
		this.calculateStartTime()
		this.calculatePastDownloaded()
		this.calculateTotalSize()
	}

	this.calculateStats = () => {
		this.calculateTotalDownloaded()
		this.calculateTotalCompleted()
		this.calculatePresentDownloaded()
		this.calculatePresentTime()
		this.calculateSpeeds()
		this.calculateFutureRemaining()
		this.calculateFutureEta()
	}

	this.handleFinishDownload = () => {
		this.calculateTotalDownloaded()
		this.calculateTotalCompleted()
		this.calculatePresentDownloaded()
		this.calculateEndTime()
		this.calculateSpeeds()
		this.calculateFutureRemaining()
		this.calculateFutureEta()
		clearInterval(this.updateInterval)
		this.emit('finish', this.stats)
	}

	this.calculateDownloaded = () => {
		let { threads, positions } = this.meta

		if(!threads) { return 0 }

		let downloaded = 0
		threads.forEach((thread, idx) => {
			downloaded += positions[idx] - thread[0]
		})

		return downloaded
	}

	this.calculateStartTime = () => {
		if(!this.stats.time.start) {
			this.stats.time.start = Math.floor(Date.now())
		}
	}

	this.calculateEndTime = () => {
		this.stats.time.end = Math.floor(Date.now())
	}

	this.calculatePastDownloaded = () => {
		this.stats.past.downloaded = this.calculateDownloaded()
	}

	this.calculateTotalSize = () => {
		this.stats.total.size = this.meta.filesize
	}
	
	this.calculateTotalDownloaded = () => {
		if(!this.stats.total.downloaded) {
			this.stats.present.deltaDownloaded = this.stats.past.downloaded
		} else {
			this.stats.present.deltaDownloaded = this.stats.total.downloaded
		}
		this.stats.total.downloaded = this.calculateDownloaded()
		this.stats.present.deltaDownloaded = this.stats.total.downloaded - this.stats.present.deltaDownloaded
	}

	this.calculateTotalCompleted = () => {
		let { downloaded, size } = this.stats.total
		this.stats.total.completed = 100*downloaded / size
	}

	this.calculatePresentDownloaded = () => {
		this.stats.present.downloaded = this.stats.total.downloaded - this.stats.past.downloaded
	}

	this.calculatePresentTime = () => {
		this.stats.present.time += this.options.throttleRate
	}

	this.calculateSpeeds = () => {
		this.stats.present.averageSpeed = 1000*this.stats.present.downloaded / this.stats.present.time
		this.stats.present.speed = this.stats.present.averageSpeed
	}

	this.calculateFutureRemaining = () => {
		this.stats.future.remaining = this.stats.total.size - this.stats.total.downloaded
	}

	this.calculateFutureEta = () => {
		this.stats.future.eta = this.stats.future.remaining / this.stats.present.averageSpeed
	}
	//endregion

	this.handleError = err => {
		this.emit('error', err)
		if(this.retried < this.options.retry) {
			this.restart()
			this.retried++
		} else {
			this.pause()
		}
	}
}

module.exports = suDownloadItem