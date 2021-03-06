'use strict';

/**
 * Middleware that will generate the http options object, based on the request data.
 * This object will be used later, therefore it will be saved as part of the request.
 * */

var constants = require('./../config/constants'),
    url = require('url'),
    extend = require('extend');

module.exports = function(req, res, next){
	// Making use of url.parse to retrieve the query params instead of just using req.query,
	// as the latter encodes the string parameters, but we need the query string unencoded:
  var params = url.parse(req.url).query;

  if(!req.params || !req.params[0]){
    return next('No path specified');
  }

	// Require config here so it reflects invalidation of the require cache on SIGHUP:
  var config = require('./../config/config'),
	    domain = config.domains[req.params.domain],
	    path = req.params[0],
	    options = extend(true, {}, domain.options);
  if (params) {
    path = path + '?' + params;
  }

  if (domain.hasOwnProperty('root') && domain.root.length > 0) {
    // if there is a root, use this as the start of the URI
    options.path = '/' + domain.root + '/' + path;
  } else {
    // else start from the third component
    options.path = '/' + path;
  }

  // Build proxy request headers by copying across request headers from client request
  var headers = {};
  for(var header in req.headers) {
    if (req.headers.hasOwnProperty(header)) {
      if (!options.hasOwnProperty(header)) {
        if (header !== 'cookie') {   // don't copy across cookies
          headers[header] = req.headers[header];
        }
      }
    }
  }

  // Add origin header if missing, as it's not set by Firefox/IE for same-domain requests,
  // but required for the services API:
  if (!headers.origin) {
    headers.origin = req.protocol + '://' + req.headers.host;
  }

  // if present, translate access_token cookie to OAuth2 Authorisation header with bearer token
  // NOTE: the node app may be communicating with services behind the same firewall or on a different domain entirely (as is the case with nodejs-internal)
  // so we don't want to add the OAUTH2 header if communicating on port 80
  if (req.cookies.hasOwnProperty(constants.AUTH_ACCESS_TOKEN_NAME)) {
    headers.Authorization = 'Bearer '+ req.cookies[constants.AUTH_ACCESS_TOKEN_NAME];
  }

  options.headers = headers;
  options.method = req.method; // make the proxy request use the same verb as the client request

  req.options = options;

  next();
};