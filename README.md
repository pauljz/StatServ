StatServ
========
StatServ is an IRC network service that monitors various ircd vitals
and allows them to be exposed in real time via a sockets-based web interface.

It was designed to work with UnrealIRCd and IRC Services on [irc://irc.utonet.org](UtoNet),
and that's probably the only environment on which it'd work out-of-the-box;
however, it wouldn't be terribly difficult to update the regular expressions and connection
information to make it play nice with another IRCd.

Configuration
-------------
Copy ./StatServ.sample to ./StatServ
and replace the environment variables inside with appropriate values.

This relies on a few npm modules:

    npm install irc express socket.io