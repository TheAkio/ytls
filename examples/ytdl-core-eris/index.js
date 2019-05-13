'use strict';

const Eris = require('eris');
const ytdl = require('ytdl-core');
const { YouTubeLiveStream } = require('ytls');

let config;
try {
	config = require('./config.json');
} catch (e) {
	console.error('Failed to load config! Make sure it exists and is valid.');
	return;
}

const bot = new Eris(config.botToken);

bot.on('ready', () => {
	console.log('Bot ready!');

	const channel = bot.getChannel(config.channelID);
	if (channel == null || !(channel instanceof Eris.VoiceChannel)) {
		console.error('Could not find the channel. Make sure it exists, is a voice channel in a server and your bot is in the server.');
	}

	const stream = new YouTubeLiveStream(
		async () => {
			const info = await ytdl.getInfo(config.livestreamUrl);
			if (info == null) throw new Error('Livestream information not found. Make sure this stream exists.');
			
			const mpegTsFormats = info.formats.filter(f => f.container === 'ts' && f.audioBitrate != null).sort((a, b) => b.audioBitrate - a.audioBitrate);
			const format = mpegTsFormats[0];
			if (format == null) throw new Error('No compatible format for livestreams found. Make sure you use a livestream.');
	
			return format.url;
		}
	);

	stream.on('warning', (msg, error) => {
		console.warn(`Warning: ${msg}`);
		if (error != null) console.warn(error);
	});
	stream.on('error', error => {
		console.error(`Error:`, error);
	});

	channel.join().then(voiceConnection => {
		console.log('Joined voice channel!');

		voiceConnection.play(stream, {
			frameDuration: 60,
			format: null
		});
	});
});

bot.connect();
