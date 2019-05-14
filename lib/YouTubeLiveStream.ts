/*
 * Copyright 2018 TheAkio <me@theak.io>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

import { PassThrough, Readable } from 'stream';
import { URL } from 'url';
import BufferedStreamLoader from './BufferedStreamLoader';
import M3U8Parser from './M3U8Parser';

/**
 * Utility class that turns a YouTube Livestream M3U8 playlist URL into a stream containing all segments
 */
class YouTubeLiveStream extends PassThrough {
	private resolveFunc: (firstResolve: boolean) => string|Promise<string>;
	private segmentCacheCount: number = null;

	private resolvedUrl: string = null;
	private urlExpire: number = 0;
	private startSequence: string = null;

	private loadInterval: NodeJS.Timer = null;
	private isLoadingSegments: boolean = false;

	/**
	 * Creates a new YouTubeLiveStream and starts it
	 *
	 * @event error Emitted when an error occurrs on the stream. The stream will end after this.
	 * @event warning Emitted when a warning occurrs on the stream. The stream will continute normally.
	 * @param resolveFunc A function that resolves to a YouTube M3U8 playlist URL (Use YTDL or youtube-dl to get the URL)
	 * @param segmentCacheCount How many segments should be buffered. Minimum is 3. The more data is cached the more the stream is delayed
	 */
	constructor(resolveFunc: (firstResolve: boolean) => string|Promise<string>, segmentCacheCount?: number);
	/**
	 * Creates a new YouTubeLiveStream and starts it
	 *
	 * @deprecated Use a function returning a string instead of a playlist url and use on('error') and on('warning') for errors and warnings
	 * @param playlistUrl A URL pointing to the M3U8 file from YouTube (Use YTDL or youtube-dl to get this)
	 * @param segmentCacheCount How many segments should be buffered. Minimum is 3. The more data is cached the more the stream is delayed
	 * @param callbacks An object containing an optional error and/or warning callback
	 */
	constructor(playlistUrl: string, segmentCacheCount?: number, callbacks?: { error?: (err: Error) => void, warning?: (msg: string, err?: Error) => void });
	constructor() {
		super();

		// Handle constructor overloading and deprecation stuff
		let resolveFunc: () => string|Promise<string>;
		if (typeof arguments[0] === 'string') {
			console.log('YTLS deprecation warning: Using the playlist url parameter as a string is deprecated. Use a function returning a string instead');
			resolveFunc = () => arguments[0];
		} else if (typeof arguments[0] === 'function') {
			resolveFunc = arguments[0];
		}

		const segmentCacheCount: number = arguments[1] || 3;

		const callbacks: { error?: (err: Error) => void, warning?: (msg: string, err?: Error) => void } = arguments[2] || null;
		if (callbacks) {
			console.log('YTLS deprecation warning: Using error and warning callbacks is deprecated. Use on(\'error\') and on(\'warning\') instead');
			if (callbacks.error) this.on('error', callbacks.error);
			if (callbacks.warning) this.on('warning', callbacks.warning);
		}

		// Set attributes
		if (!resolveFunc) throw new Error('YTLS: First parameter is not a function');
		this.resolveFunc = resolveFunc;

		if (isNaN(segmentCacheCount)) throw new Error('YTLS: Segment cache count is NaN');
		if (segmentCacheCount < 3) throw new Error('YTLS: Segment cache count cannot be < 3');
		this.segmentCacheCount = segmentCacheCount;

		super.on('close', () => {
			if (this.loadInterval) {
				clearInterval(this.loadInterval);
				this.loadInterval = null;
			}
		});

		// Define error wrapper function so we clear interval and close the stream before passing to the user
		const errorFn = (e: Error) => {
			this.destroy();
			this.emit('error', e);
		};

		// Define load function for interval and direct call
		const loadFn = async () => {
			try {
				await this.loadSegments();
			} catch (e) {
				errorFn(e);
			}
		};

		// Start loading segments, the stream will then start
		loadFn();
		// Try segment loading. The interval is calculated by how much data is cached
		this.loadInterval = setInterval(loadFn, (this.segmentCacheCount - 2) * 4500);
	}

	private getExpireTime(url: string) {
		const matches = /(?:expire\/([0-9]+))/g.exec(url);
		if (!matches) throw new Error('YTLS: A playlist URL had no expire time');
		return parseInt(matches[1], 10);
	}

	private getSequenceID(url: string) {
		// Search for a parameter called "sq" with a numeric value
		const matches = /(?:sq\/([0-9]+))/g.exec(url);
		// If nothing is found this is bad and the stream needs to end
		if (!matches) throw new Error('YTLS: A segment URL had no sequence ID');
		// Return the match if found
		return parseInt(matches[1], 10);
	}

	private async loadSegments() {
		// Prevent this function from getting stuck and getting called again by the interval
		if (this.isLoadingSegments) {
			this.emit('warning', 'A segment load was attempted while another one was still running', null);
			return;
		}
		this.isLoadingSegments = true;

		// Check for resolved url
		if (!this.resolvedUrl || Date.now() > this.urlExpire) {
			this.resolvedUrl = await this.resolveFunc(!this.resolvedUrl);
			this.urlExpire = this.getExpireTime(this.resolvedUrl) * 1000;
		}

		// Create URL object and apply startSequence if we have one
		const url = new URL(this.resolvedUrl);
		if (this.startSequence) url.searchParams.append('start_seq', this.startSequence);

		// Download the M3U8 file
		const req = await BufferedStreamLoader.downloadTries(url.href, 3, (msg, e) => this.emit('warning', msg, e));

		// Parse M3U8
		const parser = req.pipe(new M3U8Parser());

		// Get all items in an array
		let items: string[] = [];
		parser.on('item', (item: string) => {
			items.push(item);
		});

		// Wait until the parser finishes
		await new Promise((resolve, reject) => {
			req.on('error', reject);
			parser.on('end', resolve);
		});

		// Check if load interval is still running and we got some new items. Otherwise end execution and reset status
		if (this.loadInterval == null || items.length === 0) {
			this.isLoadingSegments = false;
			return;
		}

		// Only take the last X elements if no start sequence
		if (!this.startSequence) items = items.slice(-this.segmentCacheCount);

		// Go through each URL
		for (const item of items) {
			// Download segment data
			const segment = await BufferedStreamLoader.downloadTries(item, 3, (msg, e) => this.emit('warning', msg, e));

			// Check if the loading interval exists, aka the stream is still open
			if (this.loadInterval == null) {
				this.isLoadingSegments = false;
				return;
			}

			// Pipe through this stream
			segment.pipe(this, { end: false });
		}

		// Get the last item
		const lastItem = items[items.length - 1];
		// Set the sequenceId for the next request to the one of the last item + 1
		this.startSequence = `${this.getSequenceID(lastItem) + 1}`;

		// Reset loading status
		this.isLoadingSegments = false;
	}
}

declare interface YouTubeLiveStream {
	// Had to include all the stuff from the Readable typings (╯°□°）╯︵ ┻━┻
	addListener(event: string, listener: (...args: any[]) => void): this;
	addListener(event: 'close', listener: () => void): this;
	addListener(event: 'drain', listener: () => void): this;
	addListener(event: 'error', listener: (err: Error) => void): this;
	addListener(event: 'finish', listener: () => void): this;
	addListener(event: 'pipe', listener: (src: Readable) => void): this;
	addListener(event: 'unpipe', listener: (src: Readable) => void): this;
	addListener(event: 'warning', listener: (message: string, error: Error) => void): this;

	emit(event: string | symbol, ...args: any[]): boolean;
	emit(event: 'close'): boolean;
	emit(event: 'drain', chunk: Buffer | string): boolean;
	emit(event: 'error', err: Error): boolean;
	emit(event: 'finish'): boolean;
	emit(event: 'pipe', src: Readable): boolean;
	emit(event: 'unpipe', src: Readable): boolean;
	emit(event: 'warning', message: string, error: Error): boolean;

	on(event: string, listener: (...args: any[]) => void): this;
	on(event: 'close', listener: () => void): this;
	on(event: 'drain', listener: () => void): this;
	on(event: 'error', listener: (err: Error) => void): this;
	on(event: 'finish', listener: () => void): this;
	on(event: 'pipe', listener: (src: Readable) => void): this;
	on(event: 'unpipe', listener: (src: Readable) => void): this;
	on(event: 'warning', listener: (message: string, error: Error) => void): this;

	once(event: string, listener: (...args: any[]) => void): this;
	once(event: 'close', listener: () => void): this;
	once(event: 'drain', listener: () => void): this;
	once(event: 'error', listener: (err: Error) => void): this;
	once(event: 'finish', listener: () => void): this;
	once(event: 'pipe', listener: (src: Readable) => void): this;
	once(event: 'unpipe', listener: (src: Readable) => void): this;
	once(event: 'warning', listener: (message: string, error: Error) => void): this;

	prependListener(event: string, listener: (...args: any[]) => void): this;
	prependListener(event: 'close', listener: () => void): this;
	prependListener(event: 'drain', listener: () => void): this;
	prependListener(event: 'error', listener: (err: Error) => void): this;
	prependListener(event: 'finish', listener: () => void): this;
	prependListener(event: 'pipe', listener: (src: Readable) => void): this;
	prependListener(event: 'unpipe', listener: (src: Readable) => void): this;
	prependListener(event: 'warning', listener: (message: string, error: Error) => void): this;

	prependOnceListener(event: string, listener: (...args: any[]) => void): this;
	prependOnceListener(event: 'close', listener: () => void): this;
	prependOnceListener(event: 'drain', listener: () => void): this;
	prependOnceListener(event: 'error', listener: (err: Error) => void): this;
	prependOnceListener(event: 'finish', listener: () => void): this;
	prependOnceListener(event: 'pipe', listener: (src: Readable) => void): this;
	prependOnceListener(event: 'unpipe', listener: (src: Readable) => void): this;
	prependOnceListener(event: 'warning', listener: (message: string, error: Error) => void): this;

	removeListener(event: string, listener: (...args: any[]) => void): this;
	removeListener(event: 'close', listener: () => void): this;
	removeListener(event: 'drain', listener: () => void): this;
	removeListener(event: 'error', listener: (err: Error) => void): this;
	removeListener(event: 'finish', listener: () => void): this;
	removeListener(event: 'pipe', listener: (src: Readable) => void): this;
	removeListener(event: 'unpipe', listener: (src: Readable) => void): this;
	removeListener(event: 'warning', listener: (message: string, error: Error) => void): this;
}

export default YouTubeLiveStream;
