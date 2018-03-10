YTLS [![NPM version](https://img.shields.io/npm/v/ytls.svg?style=flat-square)](https://npmjs.com/package/ytls)
===

YouTube Livestreams with NodeJS made easy

What's this?
---
This is a library that was originally designed to be used to stream YouTube livestreams through Discord with a bot. The input is a resolved YouTube livestream M3U8 file (Use node-ytdl or youtube-dl to get this) and turns into a stream of the MPEGTS segments. The stream can be re-encoded with Opus for example and then sent to Discord.

Installing
---
With NPM
```
npm install ytls
```
With Yarn
```
yarn add ytls
```

How to use
---

```js
// When using ES Modules or TypeScript
import YouTubeLiveStream from 'ytls';

// When using regular NodeJS
const { YouTubeLiveStream } = require('ytls');

// Resolve a YouTube livestream URL with ytdl-core and get a result using an M3U8 playlist
const resolved = /* (your magic resolve function that returns a proper url) */;

// The stream object is a PassThrough where other pieces of code can read from and use the data
const stream = new YouTubeLiveStream(
	resolved,
	3, // Optional, this defines how many segments should be cached. The lower this value is the more "live" the stream is.
	{
		errorCallback: (e) => {} // Optional, called whenever an error happens. The stream will end.
		warningCallback: (msg, e) => {} // Optional, called whenever a warning occurs. Stream will continue as normal.
	},
);
```

Links
---

[GitHub repository](https://github.com/TheAkio/ytls)

[NPM package](https://npmjs.com/package/ytls)

License
---

Refer to the [LICENSE](LICENSE) file.
