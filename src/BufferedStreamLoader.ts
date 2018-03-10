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
import { Duplex } from 'stream';
import { parse } from 'url';

export default class BufferedStreamLoader {

	public static async downloadTries(url: string, tryCount: number, warningCallback?: (msg: string, err: Error) => void): Promise<Duplex> {
		try {
			return await BufferedStreamLoader.download(url);
		} catch (err) {
			// TODO Eventually delay here?
			if (warningCallback) warningCallback('StreamBuffer load attempt failed', err);
			if (tryCount <= 1) throw new Error(`Could not load buffered stream after several tries: ${err.message}`);
			return BufferedStreamLoader.downloadTries(url, tryCount - 1, warningCallback);
		}
	}

	public static async download(reqUrl: string): Promise<Duplex> {
		// Download buffer
		const buffer = await BufferedStreamLoader.downloadBuffer(reqUrl);
		// Create stream duplex
		const stream = new Duplex();
		// Push buffer
		stream.push(buffer);
		// Push null because apperantly you need to do this for the stream to be readable
		stream.push(null);

		return stream;
	}

	/**
	 * Inspired by https://github.com/fent/node-miniget/blob/master/lib/index.js
	 */
	private static downloadBuffer(url: string, redirectCount: number = 0, maxRedirects = 3): Promise<Buffer> {
		return new Promise((resolvePromise, rejectPromise) => {
			let finished = false;

			const resolve = (buf: Buffer) => {
				if (finished) return;
				finished = true;
				resolvePromise(buf);
			};
			const reject = (error: Error) => {
				if (finished) return;
				finished = true;
				rejectPromise(error);
			};

			const parsed = parse(url);
			if (parsed.protocol !== 'https:') reject(new Error(`Invalid URL: ${url}`));

			const req = https.get(parsed, res => {
				if ([301, 302, 303, 307].indexOf(res.statusCode) > -1) {
					if (redirectCount >= (maxRedirects - 1)) {
						return reject(new Error('Too many redirects'));
					} else {
						return BufferedStreamLoader.downloadBuffer(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
					}
				} else if (res.statusCode < 200 || 300 <= res.statusCode) {
					return reject(new Error(`Status code: ${res.statusCode}`));
				}

				const data: Buffer[] = [];

				res.on('data', (chunk: Buffer) => {
					data.push(chunk);
				});
				res.on('end', () => {
					resolve(Buffer.concat(data));
				});

				res.on('error', reject);
			});

			req.on('error', reject);
		});
	}

}
