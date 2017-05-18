
(function(){

    const uuid = require('uuid/v1');

    var StoryCard = function(id, prototype){
        var self = {
            id : id,
            type : "story",
            name : prototype.name,
            story : prototype.story,
            result : prototype.result,
        };

        return self;
    }


    var ActionCard = function(id, prototype){
        var self = {
            id : id,
            type : "action",
            name : prototype.name,
            action : prototype.action,
        };

        return self;
    }

    /* CONSTS OF STATE ENUM*/
    const GameState = {
        NotStarted : "NotStarted",
        SetNewActivePlayer : "SetNewActionPlayer",
        CallingForStoryCard : "CallingForStoryCard",
        CallingForActionCard_1 : "CallingForActionCard_1",
        CallingForActionCard_2 : "CallingForActionCard_2",
        CallingForDecision : "CallingForDecision",
        PerformAction : "PerformAction",
        GameOver : "GameOver",
    };


    const GameEvent = {
        // initialize
        InitCardPile : "InitCardPile",

        // gameplay
        CallingForStoryCard : "CallingForStoryCard",
        HandInStoryCard : "HandInStoryCard",
        CallingForActionCard : "CallingForActionCard",
        HandInActionCard : "HandInActionCard",
        CallingForDecision : "CallingForDecision",
        MakeDecision : "MakeDecision",


        // state synchronization
        SyncStoryCards : "SyncStoryCards",
        SyncActionCards : "SyncActionCards",
        UpdateGameInfo : "UpdateGameInfo",
        AnnounceLoser : "AnnounceLoser",
    }


    var Game = function (players, table, story_types){
        var self = {
            state : GameState.NotStarted,
            players : players,      // players[playerId] = playerInstance, the socket is in the instance.
            table : table,          // table[seat] = playerId on that seat, seat = 0,1,2,3

            storyTypes : story_types,
            storyCards : {},
            storyPile : [],         // card entities inside, not uid!
            storyDiscarded : [],    // also card entities, not uid.

            actionTypes : [{name:"同意", action:"accept"}, {name:"拒绝", action:"reject"}, {name:"中立", action:"ignore"}],
            actionCards : {},
            actionPile : [],
            actionDiscarded : [],

            
            whosturn : Math.floor(Math.random() * 4),
            whosactive : -1,
            whostargeted : -1,
            whosleft : [],

            currentStory : null,
            currentActions : [],
            currentDecision : null,
        };


        self.PackInfo = function(){
            var info = {
                state : self.state,
                whosturn : self.whosturn,
                whosactive : self.whosactive,
                whostargeted : self.whostargeted,
                whosleft : self.whosleft,

                properties : [
                    self.players[self.table[0]].property,
                    self.players[self.table[1]].property,
                    self.players[self.table[2]].property,
                    self.players[self.table[3]].property,
                ],
            };

            if(self.currentStory != null)
            {
                info.currentStory = self.DesensitizeStoryCard(self.currentStory);
            }

            if(self.currentActions.length > 0)
            {
                info.currentActions = [];
                for(i in self.currentActions){
                    info.currentActions.push(self.currentActions[i].action);
                }
            }

            if(self.currentDecision != null){
                info.currentDecision = self.currentDecision;
            }

            return info; 
        }

        self.Broadcast = function(event, data){
            for(i in self.players){
                self.players[i].socket.emit(event, data);
            }
        }

        self.shuffle = function(arr){
            for(let i=arr.length-1; i>=0; i--){
                let j = Math.floor(Math.random() * (i+1));
                let t = self.actionPile[i]; 
                self.actionPile[i] = self.actionPile[j]; 
                self.actionPile[j] = t;
            }
        }


        self.BuildStoryPile = function(){
            for(let i = 0; i < 100; i++){
                let storyPrototype = self.storyTypes[Math.floor(Math.random() * self.storyTypes.length)];
                let uid = uuid();
                let storyCard = StoryCard(uid, storyPrototype);
                self.storyCards[uid] = storyCard;
                self.storyPile.push(storyCard);
            }
            // randomly generated, no need to shuffle.
        };


        self.BuildActionPile = function(){
            let n = 15;
            for(let i = 0; i < n; i++){
                let actionPrototype = self.actionTypes[i % self.actionTypes.length];
                let uid = uuid();
                let actionCard = ActionCard(uid, actionPrototype);
                self.actionPile.push(actionCard);
            }

            self.shuffle(self.actionPile);
        };


        /* Get next card in the pile, refill the pile if it is empty */
        self.NextStoryCard = function(){
            if(self.storyPile.length == 0){
                self.storyPile = self.storyDiscarded.slice(); // copy the array
                self.shuffle(self.storyPile);
                self.storyDiscarded = [];
            }
            return self.storyPile.pop();
        }

        self.NextActionCard = function(){
            if(self.actionPile.length == 0){
                self.actionPile = self.actionDiscarded.slice();
                self.shuffle(self.actionPile);
                self.actionDiscarded = [];
            }
            return self.actionPile.pop();
        }


        /* Never let clients know the uid of the card, 
           or they will cheat by modifying the game with browser */
        self.DesensitizeStoryCard = function(storyCard){
            return {
                name : storyCard.name,
                story : storyCard.story,
                result : storyCard.result,
            };
        }

        self.DesensitizeActionCard = function(actionCard){
            return {
                name : actionCard.name,
                action : actionCard.action,
            };
        }



        /* Deal the cards */
        self.DealTheCards = function(){
            for(let i = 0; i < 4; i++){
                self.players[self.table[i]].storyCards = [];
                var clientStoryCards = [];
                for(let j = 0; j < 5; j++){
                    let c = self.NextStoryCard();
                    self.players[self.table[i]].storyCards.push(c);
                    clientStoryCards.push(self.DesensitizeStoryCard(c));
                }

                self.players[self.table[i]].actionCards = [];
                var clientActionCards = [];
                for(let j = 0; j < 2; j++){
                    let c = self.NextActionCard();
                    self.players[self.table[i]].actionCards.push(c);
                    clientActionCards.push(self.DesensitizeActionCard(c));
                }

                self.players[self.table[i]].socket.emit(GameEvent.InitCardPile, {
                    storyCards : clientStoryCards,
                    actionCards : clientActionCards,
                });
            }
        }



        /* Game State Machine */
        /* Transit In */
        self.EnterState = function(newState){
            self.state = newState;

            switch(newState){
                case GameState.SetNewActivePlayer:
                {
                    self.whosturn = (self.whosturn + 1) % 4;
                    self.whosactive = self.whosturn;
                    self.whostargeted = -1;
                    self.whosleft = [];

                    self.currentActions = [];
                    self.currentStory = null;
                    self.currentDecision = null;

                    self.Transitor();
                    
                }
                break;


                case GameState.CallingForStoryCard:
                {
                    let player = self.players[self.table[self.whosturn]];
                    player.socket.emit(GameEvent.CallingForStoryCard);
                    player.socket.on(GameEvent.HandInStoryCard, self.Transitor);
                    self.Broadcast(GameEvent.UpdateGameInfo, self.PackInfo());
                }
                break;



                case GameState.CallingForActionCard_1:
                {
                    let player = self.players[self.table[self.whosactive]];
                    player.socket.emit(GameEvent.CallingForActionCard);
                    player.socket.on(GameEvent.HandInActionCard, self.Transitor);
                    self.Broadcast(GameEvent.UpdateGameInfo, self.PackInfo());
                }
                break;

                

                case GameState.CallingForActionCard_2:
                {
                    let player = self.players[self.table[self.whosactive]];
                    player.socket.emit(GameEvent.CallingForActionCard);
                    player.socket.on(GameEvent.HandInActionCard, self.Transitor);
                    self.Broadcast(GameEvent.UpdateGameInfo, self.PackInfo());
                }
                break;



                case GameState.CallingForDecision:
                {
                    let player = self.players[self.table[self.whosactive]];
                    player.socket.emit(GameEvent.CallingForDecision);
                    player.socket.on(GameEvent.MakeDecision, self.Transitor);
                    self.Broadcast(GameEvent.UpdateGameInfo, self.PackInfo());
                }
                break;


                case GameState.PerformAction:
                {
                    let player = self.players[self.table[self.whostargeted]];
                    let action = self.currentActions[self.currentDecision].action;
                    let value = self.currentStory.result[action];
                    player.property.army += value.army;
                    player.property.church += value.church;
                    player.property.eco += value.eco;
                    player.property.people += value.people;

                    if(player.property.army <= 0 || player.property.army >= 20 ||
                       player.property.church <= 0 || player.property.church >= 20 ||
                       player.property.eco <= 0 || player.property.eco >= 20 ||
                       player.property.people <= 0 || player.property.people >= 20)
                       {
                           self.EndGame({
                                   reason : "kingdomfall",
                                   loser : player
                               });
                       }
                    else {
                        self.Broadcast(GameEvent.UpdateGameInfo, self.PackInfo());
                        self.Transitor();
                    }
                    
                }
                break;

            }

        }

        /* Transit Out */
        self.Transitor = function(data=null){
            switch(self.state){
                case GameState.SetNewActivePlayer:
                self.EnterState(GameState.CallingForStoryCard);
                break;


                case GameState.CallingForStoryCard:
                {
                    // security check
                    if(data.cardIndex >= 5) {self.EnterState(self.state); break;}
                    if(data.target == self.whosturn) {self.EnterState(self.state); break;}

                    let player = self.players[self.table[self.whosturn]];
                    let card = player.storyCards[data.cardIndex];
                    player.storyCards.splice(data.cardIndex, 1);
                    player.storyCards.push(self.NextStoryCard());

                    let clientStoryCards = [];
                    for(i in player.storyCards) 
                        clientStoryCards.push(self.DesensitizeStoryCard(player.storyCards[i]));          
                    player.socket.emit(GameEvent.SyncStoryCards, clientStoryCards);

                    self.currentStory = card;
                    self.storyDiscarded.push(card);
                    self.whostargeted = data.target;
                    for(i in self.table){
                        if(i != self.whosturn && i != self.whostargeted)
                            self.whosleft.push(i);
                    }
                    
                    player.socket.removeListener(GameEvent.HandInStoryCard, self.Transitor);
                    
                    self.whosactive = self.whosleft[0];
                    self.EnterState(GameState.CallingForActionCard_1);
                }
                break;


                case GameState.CallingForActionCard_1:
                {
                    // security check
                    if(data.cardIndex >= 2) {self.EnterState(self.state); break;}
                    
                    let player = self.players[self.table[self.whosactive]];
                    let card = player.actionCards[data.cardIndex];
                    player.actionCards.splice(data.cardIndex, 1);
                    player.actionCards.push(self.NextActionCard());

                    let clientActionCards = [];
                    for(i in player.actionCards) 
                        clientActionCards.push(self.DesensitizeActionCard(player.actionCards[i]));          
                    player.socket.emit(GameEvent.SyncActionCards, clientActionCards);

                    self.currentActions.push(card);
                    self.actionDiscarded.push(card);
                    player.socket.removeListener(GameEvent.HandInActionCard, self.Transitor);

                    self.whosactive = self.whosleft[1];
                    self.EnterState(GameState.CallingForActionCard_2);
                }
                break;


                case GameState.CallingForActionCard_2:
                {
                    // security check
                    if(data.cardIndex >= 2) {self.EnterState(self.state); break;}

                    let player = self.players[self.table[self.whosactive]];
                    let card = player.actionCards[data.cardIndex];
                    player.actionCards.splice(data.cardIndex, 1);
                    player.actionCards.push(self.NextActionCard());

                    let clientActionCards = [];
                    for(i in player.actionCards) 
                        clientActionCards.push(self.DesensitizeActionCard(player.actionCards[i]));          
                    player.socket.emit(GameEvent.SyncActionCards, clientActionCards);

                    self.currentActions.push(card);
                    self.actionDiscarded.push(card);
                    player.socket.removeListener(GameEvent.HandInActionCard, self.Transitor);

                    self.whosactive = self.whostargeted;
                    self.EnterState(GameState.CallingForDecision);
                }
                break;

                case GameState.CallingForDecision:
                {
                    // security check
                    if(data.decision >= 2) {self.EnterState(self.state); break;}

                    let player = self.players[self.table[self.whosactive]];
                    
                    self.currentDecision = data.decision;
                    player.socket.removeListener(GameEvent.MakeDecision, self.Transitor);
                    self.EnterState(GameState.PerformAction);
                }
                break;

                case GameState.PerformAction:
                self.EnterState(GameState.SetNewActivePlayer);
                break;
            }

            
        }


        self.StartGame = function(end_game_callback){
            self.EndGameCallback = end_game_callback;
            self.BuildActionPile();
            self.BuildStoryPile();
            self.DealTheCards();
            self.EnterState(GameState.SetNewActivePlayer);
        }

        self.EndGame = function(args){
            switch(args.reason){
                case "kingdomfall":
                {
                    self.Broadcast(GameEvent.AnnounceLoser, args.loser.name+"的王国已经倾覆");
                }
                break;
            }

            self.EndGameCallback();
        }


        return self;
    }


    module.exports.Game = function(players, table, story_types){
        return Game(players, table, story_types);
    }

}());