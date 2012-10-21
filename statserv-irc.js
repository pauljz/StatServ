var util   = require('util')
  , events = require('events');

//
// Precompile some regular expressions that we'll use frequently.
//
var clientConnectRegex    = /^\*\*\* Notice -- Client connecting on port (\d+): (\S+) \((\S+)@(\S+)\) \[clients\]/;
var clientDisconnectRegex = /^\*\*\* Notice -- Client exiting: (\S+) \((\S+)@(\S+)\) \[(.*)\]$/;
var clientFloodRegex      = /^\*\*\* Flood -- (\S+)!(\S+)@(\S+) \((\d+)\) exceeds \(\d+\) recvQ$/;
var raw266Regex           = /^Current Global Users: (\d+)\s+Max: (\d+)$/;

var StatServIRC = function(options) {
	var _this = this;

	this.options = options;

	this.whoCallbackQueue = [];
	this.whoUsers = [];

	this.values = {};
	this.valuesTimeSeries = {};

	//
	// Configure client and connect
	//
	var irc = require('irc');
	this.client = new irc.Client( this.options.server, this.options.nickname, {
		port: 6667,
		userName: this.options.userName || 'StatServ',
		realName: this.options.realName || 'StatServ',
		showErrors: true,
		autoConnect: false,
	});
	console.time( 'connecting' );
	this.client.connect( 1, function() {
		console.timeEnd( 'connecting' );

		// Provide a hook for setup commands like opering, joining channels
		_this.emit( 'connected' );

		// Run the timed functions once on connect
		_this.everyMinute();
		_this.everyHour();

	});

	//
	// Add our own raw command to the irc lib since the send method inserts colons when it shouldn't
	//
	this.client.raw = function( command ) { // {{{
		if ( ! this.conn.requestedDisconnect ) {
			this.conn.write( command + "\r\n" );
		}
	};

	//
	// Attach utility event listeners
	//
	this.client.on( 'ctcp-version', function( from, to ) {
		_this.client.ctcp( from, 'notice', 'VERSION ' + process.env.CTCP_VERSION );
	});

	this.client.on( 'error', function() {
		console.log( "*** ERROR ***" );
		console.log( arguments );
		_this.client.say( _this.options.channel, "*** Bot error -- " + JSON.stringify( arguments ) );
	});

	//
	// Register administrative commands
	//
	this.client.on( 'message', function( nick, to, text, message ) {
		if ( to === _this.options.channel ) {
			if ( text === '!mibbit' ) {
				_this.who( '+gu http://www.mibbit.com Mibbit', function(users) {
					_this.client.say( _this.options.channel, 'There are ' + users.length + ' Mibbit users online.' );
				} );
			}
		}
	});

	//
	// Attach the major raw listeners
	//
	this.client.on( 'raw', function( message ) {
		var match, args;
		console.log( message );
		switch( message.rawCommand ) {
			case '266': { // lusers - Global Users
				match = message.args[1].match( raw266Regex );
				// match[1] = global users
				// match[2] = max global users
				_this.setValue( 'users', parseInt( match[1] ) );
			}; break;

			case '211': { // Stats L
				/* 211 args get tokenized a bit oddly by the irc module, due to the colons in ipv6 addrs:
					args:[
						'StatsBot',
						'farnsworth.us.utonet.org[@0',
						'0:0:0:0:ffff:66.228.41.40.9056][C] 0 113178169 11380239 31690321 993187 1630139 :0' ]
				*/
			}; break;

			case '352': { // WHO
				_this.whoUsers.push( message.args );
			}; break;

			case '315': { // End WHO
				_this.whoCallbackQueue.shift()( _this.whoUsers );
				_this.whoUsers = [];
			}; break;

			case 'NOTICE': {
				// Only handle SNOTICEs
				if ( typeof message.server !== 'undefined' ) {
					_this.handleSNotice( message );
				}
			}; break;
		}
	});

	//
	// Create timers
	//
	this.minutelyInterval = setInterval( function() {
		_this.everyMinute();
	}, 60000 );
	this.HourlyInterval = setInterval( function() {
		_this.everyHour();
	}, 3600000 );
	
	//
	// End of constructor definition
	//
};
util.inherits( StatServIRC, events.EventEmitter );

/**
 * Commands to execute once every minute
 */
StatServIRC.prototype.everyMinute = function() {
	this.client.raw( 'LUSERS' );
};

/**
 * Commands to execute once every hour
 */
StatServIRC.prototype.everyHour = function() {
	var _this = this;

	this.client.raw( 'STATS L' );
	this.client.say( 'OPERSERV', 'STATS ALL' );
	this.who( '+gu http://www.mibbit.com Mibbit', function(users) {
		_this.setValue( 'mibbit:users', users.length );
	});
};

/**
 * Runs a /who command and executes a callback on completion
 *
 * This builds a queue of callbacks so that you can run multiple /who commands
 * at once.  The callbacks will be executed in order since it's assumed that
 * the server will itself respond in the order requested.
 *
 * @param {String[]} commands An array of parameters to be passed to /who
 * @param {function(users)} callback A function to execute when the server responds with a 315.
 */
StatServIRC.prototype.who = function( commands, callback ) {
	this.whoCallbackQueue.push( callback );
	this.whoUsers = [];
	this.client.raw( 'WHO ' + commands );
};

/**
 * Parse SNotices. Internal method.
 */
StatServIRC.prototype.handleSNotice = function( message ) {
	var match;
	if ( match = message.args[1].match( clientConnectRegex ) ) {
		this.incValue( 'users', 1 );
		if ( match[3] === 'Mibbit' ) {
			this.incValue( 'mibbit:users', 1 );
		}
	} else if ( match = message.args[1].match( clientDisconnectRegex ) ) {
		this.incValue( 'users', -1 );
		if ( match[2] === 'Mibbit' ) {
			this.incValue( 'mibbit:users', -1 );
		}
	} else if ( match = message.args[1].match( clientFloodRegex ) ) {
		console.log( "Client flood: " );
		console.log( match );
		this.client.say( this.options.channel, match[0] );
	}
};

/**
 * Set a value afresh and emit an event that it's changed.
 *
 * @param {String} key The name of the value to set.
 * @param {String} value The new value for this key.
 */
StatServIRC.prototype.setValue = function( key, value ) {
	this.values[key] = value;
	this.emit( 'value', key, value );
}

/**
 * Increment a value by a specified amount. Emit an event.
 *
 * @param {String} key The name of the value to change.
 * @param {String} value The amount to increment/decrement by.
 */
StatServIRC.prototype.incValue = function( key, value ) {
	if ( typeof this.values[key] === 'undefined' ) {
		this.values[key] = 0;
	}
	this.values[key] = this.values[key] + value;
	this.emit( 'value', key, this.values[key] );
}

module.exports = StatServIRC;
