'use strict';

var graylog2 = require('graylog2'),
		// Logger config will not be refreshed on require cache invalidation:
		config = require('../config/config'),
		logger,
		loggerMap,
		logInterface;

// Only add the graylog config if we have valid server settings:
if (config.graylog.host && config.graylog.port) {
	logger = new graylog2.graylog({servers: [config.graylog]});
	logger.on('error', function (err) {
		console.error('Error while trying to write to graylog2:', err);
	});
} else {
	// Log to console if not logging to Graylog2:
	logger = console;
	// Map non-existing log level functions to alternatives:
	loggerMap = {
		emergency: 'error',
		critical: 'error',
		warning: 'warn',
		notice: 'log'
	};
}

function createLogFunction (level) {
	var func = logger[level] || logger[loggerMap[level]];
	return function (err, fields) {
		fields = fields || {};
		if (typeof err !== 'string') {
			if (err) {
				fields.stack = err.stack;
			}
			err = String(err);
		}
		if (!fields.appName) {
			fields.appName = 'SWA';
		}
		func.call(logger, err, fields);
	};
}

logInterface = {};
[
	'emergency',
	'critical',
	'error',
	'warning',
	'notice',
	'info'
].forEach(function (level) {
	logInterface[level] = createLogFunction(level);
});

module.exports = logInterface;
