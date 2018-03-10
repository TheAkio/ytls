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

import * as https from 'https';
import { PassThrough } from 'stream';
import { URL } from 'url';
import BufferedStreamLoader from './BufferedStreamLoader';
import M3U8Parser from './M3U8Parser';

/**
 * Utility class that turns a YouTube Livestream M3U8 playlist URL into a stream containing all segments
 */
export default class YouTubeLiveStream extends PassThrough {

	private playlistUrl: string;
	private segmentCacheCount: number = null;

	private startSequence: string = null;

	private loadInterval: NodeJS.Timer = null;
	private isLoadingSegments: boolean = false;

	private errorCallback: (err: Error) => void;
	private warningCallback: (msg: string, err?: Error) => void;

	/**
	 * Creates a new YouTubeLiveStream and starts it
	 *
	 * @param playlistUrl A URL pointing to the M3U8 file from YouTube (Use YTDL or youtube-dl to get this)
	 * @param segmentCacheCount How many segments should be buffered. Minimum is 3. The more data is cached the more the stream is delayed
	 * @param callbacks An object containing an optional error and/or warning callback
	 */
	constructor(playlistUrl: string, segmentCacheCount: number = 3, callbacks?: { error?: (err: Error) => void, warning?: (msg: string, err?: Error) => void }) {
		super();

		// Set attributes
		this.playlistUrl = playlistUrl;
		if (segmentCacheCount < 3) throw new Error('Segment cache count cannot be < 3');
		this.segmentCacheCount = segmentCacheCount;
		if (callbacks) {
			this.errorCallback = callbacks.error || null;
			this.warningCallback = callbacks.warning || null;
		}

		// Override end function to clear load interval
		this.end = () => {
			if (this.loadInterval) {
				clearInterval(this.loadInterval);
				this.loadInterval = null;
			}
			PassThrough.prototype.end.call(this);
		};

		// Define error wrapper function so we clear interval and close the stream before passing to the user
		const errorFn = (e: Error) => {
			this.end();
			if (this.errorCallback) callbacks.error(e);
		};

		// Register error event on this PassThrough
		this.on('error', e => {
			if (this.errorCallback) errorFn(e);
		});

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
		this.loadInterval = setInterval(loadFn, 4500 * (this.segmentCacheCount - 2));
	}

	private getSequenceID(url: string) {
		// Search for a parameter called "sq" with a numeric value
		const matches = /(?:sq\/([0-9]+))/g.exec(url);
		// If nothing is found this is bad and the stream needs to end
		if (!matches) throw new Error('A segment URL had no sequence ID');
		// Return the match if found
		return matches[1];
	}

	private async loadSegments() {
		// Prevent this function from getting stuck and getting called again by the interval
		if (this.isLoadingSegments) {
			if (this.warningCallback) this.warningCallback('A segment load was attempted while another one was still running');
			return;
		}
		this.isLoadingSegments = true;

		// Create URL object and apply startSequence if we have one
		const url = new URL(this.playlistUrl);
		if (this.startSequence) url.searchParams.append('start_seq', this.startSequence);

		// Download the M3U8 file
		const req = await BufferedStreamLoader.downloadTries(url.href, 3, this.warningCallback);

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
			const segment = await BufferedStreamLoader.downloadTries(item, 3, this.warningCallback);

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
		this.startSequence = `${parseInt(this.getSequenceID(lastItem), 10) + 1}`;

		// Reset loading status
		this.isLoadingSegments = false;
	}
}
