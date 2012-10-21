var StatServIRC = require('./statserv-irc');
var bot;

//
// Create basic http/ws server
//
var express = require('express')
  , app = express()
  , server = require('http').createServer(app)
  , io = require('socket.io').listen(server);

server.listen(8181);

app.get( '/', function( req, res ) {
	res.sendfile( __dirname + '/public/index.html' );
});

//
// Create bot
//
bot = new StatServIRC({
	server:   process.env.SERVER,
	nickname: process.env.NICKNAME,
	channel:  process.env.CHANNEL,
	userName: process.env.NICKNAME,
	realName: process.env.NICKNAME,
});
bot.on( 'connected', function() {
	bot.client.send( 'OPER', process.env.OPER_USERNAME, process.env.OPER_PASSWORD );
	bot.client.say( 'NickServ', 'IDENTIFY ' + process.env.NICKSERV_PASSWORD );
	bot.client.raw( 'MODE ' + process.env.NICKNAME + ' +Bs +cn' );
});

//
// Attach value change listener
//
bot.on( 'value', function( key, value ) {
	io.sockets.emit( 'value', key, value );
});

//
// Attack socket.io connection listener
//
io.sockets.on( 'connection', function( socket ) {
	socket.emit( 'values', bot.values );
});
