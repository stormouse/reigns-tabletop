
/* ---  establish server  --- */
var express = require('express')
var app = express();
var cors = require('cors');
var serv = require('http').Server(app);

app.use(cors());

app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
});
app.use("/img", express.static(__dirname + '/img'));
app.use("/js", express.static(__dirname + '/js'));

serv.listen(8080, "0.0.0.0");
console.log('Server started.')


var io = require('socket.io')(serv);

/* --- load story cards from db --- */
var ALL_STORY_TYPES = [];
var ALL_ACTION_TYPES = [];


const sqlite = require('sqlite3');
let db = new sqlite.Database('./database.db');


function LoadStoryCards(){
    db.all("select * from storycards", (err, rows) => {
        OnStoryRowsLoaded(err, rows);
    });
}


function LoadActionCards(){
    db.all("select * from actioncards", (err, rows) => {
        OnActionRowsLoaded(err, rows);
    });
}

function OnStoryRowsLoaded(err, rows){
    for(i in rows){
        let data = {
            name : rows[i].name,
            story : rows[i].story,
            result : JSON.parse(rows[i].result),
        };

        ALL_STORY_TYPES.push(data);
    }

    LoadActionCards();
}

function OnActionRowsLoaded(err, rows){
    for(i in rows){
        let data = {
            name : rows[i].name,
            action : rows[i].action,
        };

        ALL_ACTION_TYPES.push(data);
    }

    StartRoom();
}


/* --- import game module --- */

const GameMod = require("./game");

var User = function(id, socket, name){
    var self = {
        id : id,
        socket : socket,
        name : name,
    };

    return self;
}
User.list = {};


var Player = function(id, socket){
    var self = {
        id : id,
        socket : socket,
    }

    self.storyCards = [];
    self.actionCards = [];
    self.property = {
        army : 10,
        church : 10,
        eco : 10,
        people : 10,
    };
    return self;
}




/* --- create a game room to settle players --- */
var Room = function(){

    var self = {
        sockets : {},
        table : [-1, -1, -1, -1],
        ready : [false, false, false, false],
    };


    self.Broadcast = function(event, data){
        for(i in User.list){
            User.list[i].socket.emit(event, data);
        }
    };


    self.BroadcastSeatInfo = function(){
        let playerNames = [
            self.table[0] != -1 ? User.list[self.table[0]].name : "<空闲>",
            self.table[1] != -1 ? User.list[self.table[1]].name : "<空闲>",
            self.table[2] != -1 ? User.list[self.table[2]].name : "<空闲>",
            self.table[3] != -1 ? User.list[self.table[3]].name : "<空闲>",
        ];

        let playerReady = [
            self.ready[0] ? "[已准备]" : "",
            self.ready[1] ? "[已准备]" : "",
            self.ready[2] ? "[已准备]" : "",
            self.ready[3] ? "[已准备]" : "",
        ];

        self.Broadcast("UpdateSeatInfo", {names:playerNames, ready:playerReady});
    };

    self.ResetRoom = function(){
        self.table = [-1, -1, -1, -1];
        self.ready = [false, false, false, false];
        self.BroadcastSeatInfo();
    }


    io.on('connection', function(socket){

        /* DEBUG PRINT */

        socket.on('debugPrint', function(msg){
            socket.emit('AddToChat', eval(msg));
        });

        socket.on("Login", function(data){
            if(Object.keys(User.list) == 4){
                socket.emit("LoginResponse", {reason : "房间已满"});
                return;
            }

            if(data.paraphrase != "886") {
                socket.emit("LoginResponse", {reason : "密码不正确"});
                return;
            }

            for(i in User.list){
                if(User.list[i].name == data.username){
                    socket.emit("LoginResponse", {reason : "玩家昵称被占用"});
                    return;
                }
            }

            let uid = Math.floor(Math.random() * 100000);
            while(uid in User.list){
                uid = Math.floor(Math.random() * 100000);
            }

            socket.id = uid;

            var user = User(uid, socket, data.username);
            User.list[uid] = user;

            socket.emit("LoginResponse", {id : uid, success:true});
            self.Broadcast("AddToChat", "玩家["+user.name+"]加入了房间");
            self.BroadcastSeatInfo();

            socket.on("Sit", function(data){
                let seatIndex = data.seat;
                if(self.table[seatIndex] == -1)
                {
                    for(i in self.table){
                        if(self.table[i] == socket.id){
                            self.table[i] = -1;
                            self.ready[i] = false;
                        }
                    }
                    self.table[seatIndex] = socket.id;
                }
                self.BroadcastSeatInfo();
            });


            socket.on("disconnect", function(){
                for(i in self.table){
                    if(self.table[i] == socket.id){
                        self.table[i] = -1;
                        self.ready[i] = false;
                    }
                }
                self.Broadcast("AddToChat", "玩家["+User.list[socket.id].name+"]离开了房间");
                self.BroadcastSeatInfo();
                if(self.game != null){
                    self.game.EndGame({reason: "玩家["+User.list[socket.id].name+"]离开了游戏"})
                }
                delete User.list[socket.id];
            });


            socket.on("Ready", function(){
                for(i in self.table){
                    if(self.table[i] == socket.id) self.ready[i] = true;
                }

                self.Broadcast("AddToChat", "玩家["+User.list[socket.id].name+"]已做好准备");
                self.BroadcastSeatInfo();

                let all_ready = true;
                for(i in self.ready) all_ready = all_ready && self.ready[i];

                if(all_ready){
                    var players = {};
                    for(id in User.list){
                        players[id] = Player(id, User.list[id].socket);
                        players[id].socket.emit("StartGame");
                    }
                    self.game = GameMod.Game(players, self.table, ALL_STORY_TYPES);
                    self.game.StartGame(function(){
                        self.ResetRoom();
                        self.game = null;
                    });
                }
            });
        });

    });

    return self;
};


function StartRoom(){
    var room = Room();
}


// load story & load action & start room
LoadStoryCards();