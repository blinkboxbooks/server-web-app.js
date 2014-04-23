'use strict';

var express = require('express'),
	constants = require('./../config/constants'),
	config = require('./../config/config'),
	repository = require('./../config/repository'),
	bugsense = require('./../config/bugsense'),
	middleware = require('./../scripts'),
	router = express.Router(),
	http = require('http'),
	https = require('https'),
	querystring = require('querystring'),
	path = '/:domain/*';

router
	.use(path, middleware.domain) // verifies that domain is valid
	.use(path, middleware.options) // creates options options to be used for proxy request
	.use(path, middleware.reverse) // reverses accept and content-type headers
	.use(path, middleware.user) // handle special case of /users/ requests
	.use(path, function(req, res){

		// Make the proxy HTTP request
		var proxy_scheme = req.options.port === 443 ? https : http;
		var proxy_request_body;

		if (req.method === 'POST' || req.method === 'PATCH') {
			proxy_request_body = querystring.stringify(req.body);
		}

		// make proxy request
		var _updateAccessToken = function(oldAT, newAT, obj){
			// add semantic version number:
			obj.version = constants.TOKEN_STORAGE_VERSION;

			// delete old access token, if it exists
			repository.del(oldAT);

			// set the access/refresh token in the key/value store
			repository.set(newAT, JSON.stringify(obj));
		};

		/**
		 * Will parse the response for the website by setting the headers, handling cookies etc.
		 * Notice: This method will sends data back to the website
		 * @param proxy_response The response object
		 * @private
		 */
		var _parseResponse = function(proxy_response){
			if(res.headersSent){
				return;
			}
			var chunked = proxy_response.headers['transfer-encoding'] === 'chunked';

			var response_headers = {};
			// copy accross headers from proxy response to response
			for (var header in proxy_response.headers) {
				response_headers[header] = proxy_response.headers[header];
			}

			// transform API services content-type to application/json
			if (proxy_response.headers.hasOwnProperty('content-type')) {
				if (proxy_response.headers['content-type'].indexOf(constants.BBB_CONTENT_TYPE) === 0) {
					response_headers['content-type'] = 'application/json';
				}
			}
			// set status code if chunked
			if(chunked){
				res.writeHead(proxy_response.statusCode, response_headers);
			} else {
				for(var index in response_headers){
					res.setHeader(index, response_headers[index]);
				}
				res.status(proxy_response.statusCode);
			}
			var response_body = '';
			proxy_response.on('data', function (chunk) {
				response_body += chunk;
				if (!chunked) {
					// If appropriate, translate the authentication OAuth2 bearer token back to a cookie
					if ((req.options.path.indexOf(constants.AUTH_PATH_COMPONENT) !== -1 || req.options.path.indexOf(constants.AUTH_USERS_PATH) !== -1) &&
						proxy_response.headers.hasOwnProperty('content-type') &&
						proxy_response.headers['content-type'].indexOf('application/json') === 0) {
						try {
							var json_response = JSON.parse(response_body);
							var access_token;
							if (json_response.hasOwnProperty(constants.AUTH_ACCESS_TOKEN_NAME)) {
								// response is a refresh token request to the /oauth/token endpoint
								access_token = json_response[constants.AUTH_ACCESS_TOKEN_NAME];
								var refresh_token = json_response[constants.AUTH_REFRESH_TOKEN_NAME];

								// get the user id from the response
								var user_id = json_response.user_id.split(':');
								user_id = user_id[user_id.length - 1];

								// handle persistent and non-persistent authentication
								var expiresDate = req.param(constants.AUTH_PARAM_REMEMBER_ME) === 'true' ? new Date(Date.now() + constants.AUTH_MAX_AGE) : null;

								res.cookie(constants.AUTH_ACCESS_TOKEN_NAME, access_token, { path: '/api', expires: expiresDate, httpOnly: true, secure: true });

								// save new access token
								_updateAccessToken(req.cookies[constants.AUTH_ACCESS_TOKEN_NAME], access_token, {
									refresh_token: refresh_token,
									user_id: user_id,
									remember_me: expiresDate !== null
								});

								// Strip the access and refresh tokens from the response body:
								delete json_response[constants.AUTH_REFRESH_TOKEN_NAME];
								delete json_response[constants.AUTH_ACCESS_TOKEN_NAME];
								chunk = JSON.stringify(json_response);

								res.setHeader('Content-Length', Buffer.byteLength(chunk));
							}
						}
						catch (e) {
							console.log('Invalid JSON when attempting to parse response body for auth token');
							e.message += ' - Invalid JSON when attempting to parse response body for auth token';
							bugsense.logError(e);
						}
					}
				}
				res.write(chunk);
			});

			proxy_response.on('end', function() {
				res.end();
			});
		};

		/**
		 * perform a request
		 * @param options request options
		 * @param onSuccess function to call on successful request
		 * @param onError function to call on failure request
		 * @returns {*} return the response object
		 * @private
		 */
		var _request = function(options, onSuccess, onError, cookie){
			var request = proxy_scheme.request(options, function(proxy_response){
				if(res.headersSent){
					return;
				}
				// update cookie on success
				if(cookie && proxy_response.statusCode === 200){
					res.cookie(cookie.name, cookie.value, cookie.prop);
				}
				onSuccess(proxy_response);
			}).on('error', function(err){
					if(typeof onError === 'function'){
						onError(err);
					}
				});
			request.end();
			return request;
		};

		var _refreshTokenOptions = function(post_data){
			return {
				host: config.api_domains.auth.options.host,
				path: constants.REFRESH_TOKEN_PATH,
				port: config.api_domains.auth.options.port,
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Content-Length': Buffer.byteLength(post_data)
				}
			};
		};

		/**
		 * function that refreshes the access token (AT)
		 * @param refresh_token the refresh token to use to get a new AT
		 * @param onSuccess function to call when getting a new AT
		 * @param onError function to call on error
		 * @private
		 */
		var _refreshToken = function(refresh_token, onSuccess, onError){
			var post_data = querystring.stringify({
				refresh_token: refresh_token,
				grant_type: constants.AUTH_REFRESH_TOKEN_NAME
			});
			var obj;
			var post_req = _request(_refreshTokenOptions(post_data), function(response){
				if(response.statusCode === 200){
					response.on('data', function (chunk) {
						try{
							obj = JSON.parse(chunk + '');
						} catch(err){
							if(typeof onError === 'function'){
								onError('Invalid JSON when attempting to parse response body for refresh token');
							}
						}
					});
					response.on('end', function() {
						if(typeof onSuccess === 'function'){
							onSuccess(obj);
						}
					});
				} else {
					if(typeof onError === 'function'){
						onError();
					}
				}
			}, function(error){
				if(typeof onError === 'function'){
					onError(error);
				}
			});
			post_req.write(post_data);
			post_req.end();
		};

		// generic error handler
		var _errorHandler = function (e) {
			if(res.headersSent){
				return;
			}
			var msg = { error: e.message.replace(/\"/g, '') };      // strip any double quotes TODO: should handle single quotes too
			var response = JSON.stringify(msg);
			console.log('error', msg); //uncomment to see error message
			res.set('Content-Type', 'application/json');
			res.set('Content-length', Buffer.byteLength(response));
			res.send(500, response);
			res.end();
		};

		// console.log(options, proxy_request_body, req.body);
		// make request on behalf of the website
		var proxy_request = _request(req.options,
			// on success
			function(proxy_response){
				// do not continue if the response has already been sent (example timeout)
				if(res.headersSent){
					return;
				}
				// console.log('response', proxy_response.statusCode);
				// if token invalid/expired
				var error_message = proxy_response.headers['www-authenticate'] || '';
				if(proxy_response.statusCode === 401 && (error_message.indexOf(constants.INVALID_TOKEN) !== -1 || error_message.indexOf(constants.EXPIRED_TOKEN) !== -1)){
					// get refresh token for the invalid token
					if(req.options.headers.Authorization){
						var access_token = req.options.headers.Authorization.substr('Bearer '.length);

						repository.get(access_token).then(function(value){
							try{
								var obj = JSON.parse(value),
									refresh_token = obj.refresh_token,
									remember_me = !!obj.remember_me, // convert remember_me to its boolean value
									user_id = obj.user_id;
								// get new access token
								_refreshToken(refresh_token, function(result){
									var new_access_token = result.access_token;

									// set expiry date
									var expiresDate = remember_me ? new Date(Date.now() + constants.AUTH_MAX_AGE) : null;

									// save new access token
									_updateAccessToken(access_token, new_access_token, {
										refresh_token: refresh_token,
										user_id: user_id,
										remember_me: expiresDate !== null
									});

									// update authorization
									req.options.headers.Authorization = 'Bearer '+ new_access_token;

									// redo the request
									_request(req.options, _parseResponse, _errorHandler, {
										name: constants.AUTH_ACCESS_TOKEN_NAME,
										value: new_access_token,
										prop: { expires: expiresDate, path: '/api', httpOnly: true, secure: true }
									});
								}, function(){
									// refresh token invalid, send back result as is
									_parseResponse(proxy_response);
								});
							} catch(err) {
								// JSON parsing failed, refresh token not found, send back the result as is
								_parseResponse(proxy_response);
							}
						}, function(){
							// Redis error, continue with response
							_parseResponse(proxy_response);
						});
					} else {
						// Token does not exist on the client, sending the response back as is
						_parseResponse(proxy_response);
					}
				} else {
					// everything is ok (200)
					_parseResponse(proxy_response);
				}
			},
			_errorHandler
		);

		// set a timeout handler
		req.on('timeout', function () {
			// cancel any ongoing requests
			proxy_request.abort();
		});

		if (req.method === 'POST'|| req.method === 'PATCH') {
			proxy_request.write(proxy_request_body);
		}
		proxy_request.end();
	});

module.exports = router;