exports.Collider = function(options){
    this._firstStep = 0;
    this._stepSize = typeof(options.stepSize == 'number') ? parseInt(options.stepSize, 10) : 5;
    this._numPlayers = 0;
    if(typeof(options.movementFunction != 'function')){
        this.movementFunction  = function(startPosition, endPosition, startPositionTime, endPositionTime, interpolationTime){
            return{
                'x': (endPosition.x - startPosition.x) * (interpolationTime / (endPositionTime + startPositionTime)),
                'y': (endPosition.y - startPosition.y) * (interpolationTime / (endPositionTime + startPositionTime))
            };
        };
    }
    if(typeof(options.collisionFunction) != 'function') console.log("ERROR: No collision function defined for Collider!");
    this.collisionFunction = options.collisionFunction;
    this._updateTable = {};

    //playerdata comes in with the form {playerId: <player id>, x: <player x>, y: <player y>}
    this.addPlayer = function(time, playerData){
        if(!(typeof(playerData.x) === 'number' && typeof(playerData.y === 'number'))){
            console.log("Error: playerData is not numbers!");
            return;
        }
        var currStep = time - (time % this._stepSize);
        var checkStep = currStep;

        if(this._numPlayers > 0){
            while(typeof(this._updateTable[checkStep]) == 'undefined' && checkStep >= this._firstStep){
                this._updateTable[checkStep] = {num: 1, tot: this._numPlayers + 1, data: {}};
                this._updateTable[checkStep].data[playerData.playerId] = {'x': playerData.x, 'y': playerData.y};
                checkStep -= this._stepSize;
            }
        } else{
            this._updateTable[checkStep] = {num: 1, tot: 1, data: {}};
            this._updateTable[checkStep].data[playerData.playerId] = {'x': playerData.x, 'y': playerData.y};
            this._firstStep = checkStep;
        }
        this._numPlayers ++;
    };

    this.removePlayer = function(time, playerId){
        this._numPlayers --;
        var currStep = time - (time % this._stepSize);
        var checkStep = currStep;
        while(typeof(this._updateTable[checkStep]) == 'undefined' || typeof(this._updateTable[checkStep].data[playerId]) == 'undefined'){ //for each row going back until the last time the player sent data
            if(typeof(this._updateTable[checkStep]) != 'undefined'){ //if the row exists
                this._updateTable[checkStep].tot = this._numPlayers;
            }
            checkStep -= this._stepSize;
        }
        //if there are no players, just reset the game and return
        if(this._numPlayers === 0){
            this._firstStep = 0;
            this._updateTable = {};
            return;
        }
        //Otherwise, step forward through the entire table and remove now-full rows
        checkStep = this._firstStep;
        while(checkStep < currStep && typeof(this._updateTable[checkStep]) != 'undefined'){
            if(this._updateTable[checkStep].num >= this._updateTable[checkStep].tot && typeof(this._updateTable[checkStep - this._stepSize]) != 'undefined' && this._updateTable[checkStep - this._stepSize].num >= this._updateTable[checkStep  - this._stepSize].tot){
                delete this._updateTable[checkStep - this._stepSize];
                this._firstStep = checkStep;
            }
            checkStep += this._stepSize;
        }
    };

    /*
        takes the user update data in the form
        {playerId: <playerID>, x: <player x coord>, y: <player y coord>}
        the time should be the time that the server received the packet, minus half of the ping time to the client
        (good luck figuring that out!)
    */
    this.handleUpdate = function(time, updateData){
        if(!(typeof(updateData.x) === 'number' && typeof(updateData.y === 'number'))){
            console.log("Error: updateData is not numbers!");
            return;
        }
        //figure out which step we're on        
        var currStep = time - (time % this._stepSize);
        var beginStep = currStep;
        var checkStep = currStep;
        //check to see if the player has already sent a packet this step
        if(typeof(this._updateTable[currStep]) == 'undefined' || (typeof(this._updateTable[currStep]) != 'undefined' && typeof(this._updateTable[currStep].data[updateData.playerId]) == 'undefined')){ //they haven't
            //find the next previous row containing data from the current player
            while(beginStep > this._firstStep && (typeof(this._updateTable[beginStep]) == 'undefined' || typeof(this._updateTable[beginStep].data[updateData.playerId]) == 'undefined')){
                beginStep -= this._stepSize;
            }
            //create the steps up and including this one if they don't exist
            while(typeof(this._updateTable[checkStep]) == 'undefined' && checkStep >= beginStep){
                //num = number of players who have data in this row
                //tot = total number of players in the game at this row time
                this._updateTable[checkStep] = {num: 0, tot: this._numPlayers, data: {}};
                checkStep -= this._stepSize;
            }
        } else{ //they have
            return []; //discard the data
        }
        //put the new data into the table at the correct step
        this._updateTable[currStep].data[updateData.playerId] = {
            'x': updateData.x,
            'y': updateData.y
        };
        this._updateTable[currStep].num ++;
        //step forward and fill all intermediate rows with interpolated data
        //as soon as we add each datum, check for collisions at that time
        var collisions = [];
        interpolationStep = beginStep;
        while(interpolationStep <= currStep){
            if(interpolationStep != currStep && interpolationStep != beginStep){ // on every step except the first and last
                var formattedData = {
                    "playerId": updateData.playerId,
                    "x": this._updateTable[beginStep].data[updateData.playerId].x,
                    "y": this._updateTable[beginStep].data[updateData.playerId].y
                };
                this._updateTable[interpolationStep].data[updateData.playerId] = this.movementFunction(formattedData, updateData, beginStep, currStep, interpolationStep);
                this._updateTable[interpolationStep].num ++; //we have added some data to a row
            }
            //do collision detection against all other existing players at that row
            for(var otherPlayer in this._updateTable[interpolationStep].data){ //for each player in the row
                if(otherPlayer != updateData.playerId){ //don't check the player against itself
                    var otherPlayerData = this._updateTable[interpolationStep].data[otherPlayer]; //create a temp variable
                    otherPlayerData.playerId = otherPlayer; //so that we can append the player's id datum
                    var collision = this.collisionFunction(updateData, otherPlayerData); //check for a collision. Collision data if there was, false otherwise
                    if(collision !== false){ //if there is a collison
                        collisions.push({
                            'step' : interpolationStep,
                            'collision': collision
                        }); //push that collision data, including the time when the collision happened, onto an array
                    }
                }
            }
            //remove rows that are no longer necessary
            if(typeof(this._updateTable[interpolationStep - this._stepSize]) != 'undefined'){
                if(this._updateTable[interpolationStep].num >= this._updateTable[interpolationStep].tot && this._updateTable[interpolationStep - this._stepSize].num >= this._updateTable[interpolationStep  - this._stepSize].tot){
                    delete this._updateTable[interpolationStep - this._stepSize];
                    this._firstStep = interpolationStep;
                    beginStep = interpolationStep;
                }
            }
            interpolationStep += this._stepSize; //go to the next row
        }
        return collisions;
    };
};