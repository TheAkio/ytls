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

import { Writable } from 'stream';

/*
 * Inspired by https://github.com/fent/node-m3u8stream/blob/master/lib/m3u8-parser.js
 */
export default class M3U8Parser extends Writable {
	private lastLine: string = '';

	constructor() {
		super({ decodeStrings: false });

		this.on('finish', () => {
			this.parseLine(this.lastLine);
			this.emit('end');
		});
	}

	private parseLine(line: string) {
		const tag = line.match(/^#(EXT[A-Z0-9-]+)(?::(.*))?/);
		if (tag) {
			this.emit('tag', tag[1], tag[2] || null);
		} else if (!/^#/.test(line) && line.trim()) {
			this.emit('item', line.trim());
		}
	}

	public _write(chunk: Buffer, encoding: string, callback: () => void) {
		const lines = chunk.toString('utf8').split('\n');
		if (this.lastLine) lines[0] = this.lastLine + lines[0];

		lines.forEach((line, i) => {
			if (i < lines.length - 1) {
				this.parseLine(line);
			} else {
				this.lastLine = line;
			}
		});

		callback();
	}
}
