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
npm i ytls
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

// The stream object is a PassThrough where other pieces of code can read from and use the data
const stream = new YouTubeLiveStream(
	// This function will be called every 6 hours because YouTube livestreams have an expiration date
	// firstResolve indicates whether this is the first time this function is called or not
	// You can use firstResolve if you already resolved the stream before
	// This function will also work without the "async" keyword
	async (firstResolve) => {
		// Resolve a YouTube livestream URL with ytdl-core and get a result using an M3U8 playlist
		return /* (your magic resolve function that returns a proper url) */;
	},

	// Optional, this defines how many segments should be cached. The lower this value is the more "live" the stream is
	3,
);

// Required, if not handled the NodeJS process might exit once an error is thrown. The stream will end
stream.on('error', (e) => {
	// Oh-oh Error
});

// Optional, called whenever a warning occurs. Stream will continue as normal. This will usually be some YouTube randomness stuff
stream.on('warning', (msg, e) => {
	// Do something
});

// Optional, called whenever new data has been downloaded. This is useful if the reader requires data to be available instantly and may close the stream if no data is available.
stream.on('available' () => {
	// Do something
});
```

Links
---

[GitHub repository](https://github.com/TheAkio/ytls)

[NPM package](https://npmjs.com/package/ytls)

License
---

Refer to the [LICENSE](LICENSE) file.
