'use strict';

/**
 * Load configuration file
 */

var merchant_arg = process.argv.indexOf('-merchantKey');
var google_arg = process.argv.indexOf('-googleAnalyticsID');
var config = require('../config/config.json');
global.api_domains = config.domains;
global.api_timeout = config.timeout || 10;
global.databaseDomain = config.databaseDomain;
global.databasePort = config.databasePort;

// Override the client config if defined in the command line parameters
global.clientConfig = {
	'merchantKey': merchant_arg !== -1 ? process.argv[merchant_arg + 1] : config.clientConfig.merchantKey,
	'googleAnalyticsID': google_arg !== -1 ? process.argv[google_arg + 1] : config.clientConfig.googleAnalyticsID,
	'nonSecureServicesDomain': config.clientConfig.nonSecureServicesDomain
};

