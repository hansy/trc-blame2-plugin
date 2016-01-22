// TypeScript
// JScript functions for BasicList.Html. 
// This calls TRC APIs and binds to specific HTML elements from the page.  
/// <reference path="..\..\trc.ts" />
// Global reference to the current sheet;
var _sheet;
// Startup function called by the plugin
function PluginMain(sheet) {
    // clear previous results
    $('#deltaGrid').empty();
    $('#deltasPerCel').empty();
    $('#deltas').empty();
    _sheet = sheet; // Save for when we do Post
    trcGetSheetDeltas(sheet, function (deltas) {
        renderDeltas(deltas);
        renderPerUserCountDeltas(deltas);
    });
}
/*
$$$
- column for LastUser per RecId
- count per cell (identify high contention)
    color code high contention cells. If it's been changed by more than 1 user?
*/
// Helper for managing a sparse array of deltas. 
var DeltaGrid = (function () {
    function DeltaGrid() {
        this._columns = {}; // set of column names that were modified
        this._map = {}; // recId --> (columnName --> value)
        this._perCel = {}; // map KEY --> IDeltaInfo[]
        //  unique users that edited a cell. Helps identify contention 
        this._uniquePerCel = {}; // map KEY --> (User --> bool)  
    }
    DeltaGrid.prototype.AddPerCel = function (recId, columnName, delta) {
        // track deltas that modified this specific cell 
        var key = recId + "_" + columnName;
        var l = this._perCel[key];
        if (l == undefined) {
            l = [];
            this._perCel[key] = l;
        }
        l.push(delta);
        // Track number of users that modified this specific cell
        var l2 = this._uniquePerCel[key];
        if (l2 == undefined) {
            l2 = {};
            this._uniquePerCel[key] = l2;
        }
        l2[delta.User] = true;
    };
    // Get a list of deltas that were applied to this single cell. 
    // Useful to find contention. 
    // 0-length array if no changes. 
    DeltaGrid.prototype.GetDeltasPerCel = function (recId, columnName) {
        var key = recId + "_" + columnName;
        var l = this._perCel[key];
        if (l == undefined) {
            l = []; //
        }
        return l;
    };
    DeltaGrid.prototype.GetUserCountPerCel = function (recId, columnName) {
        var key = recId + "_" + columnName;
        var l2 = this._uniquePerCel[key];
        var users = dict2array(l2);
        return users.length;
    };
    DeltaGrid.prototype.Add = function (delta) {
        var change = delta.Value;
        var recIds = change["RecId"];
        var len = recIds.length;
        for (var columnName in change) {
            this._columns[columnName] = true;
            if (columnName != "RecId") {
                for (var rowId = 0; rowId < len; rowId++) {
                    var columnData = change[columnName];
                    var recId = recIds[rowId];
                    this.AddPerCel(recId, columnName, delta);
                    this.AddOne(recId, columnName, columnData[rowId]);
                }
            }
        }
    };
    // Record one entry 
    DeltaGrid.prototype.AddOne = function (recId, columnName, value) {
        var l = this._map[recId];
        if (l == undefined) {
            l = {};
            this._map[recId] = l;
        }
        l[columnName] = value;
    };
    // Return the set of column names that have been changed. 
    DeltaGrid.prototype.GetColumns = function () {
        var columnNames = dict2array(this._columns);
        return columnNames;
    };
    return DeltaGrid;
})();
;
// General purpose helper.
// Return the key array for a dictionary
function dict2array(dict) {
    var keys = [];
    if (dict == undefined) {
        return keys;
    }
    for (var key in dict) {
        if (dict.hasOwnProperty(key)) {
            keys.push(key);
        }
    }
    return keys;
}
// Show compressed grid of just the deltas provided. 
function renderDeltas(deltas) {
    var store = new DeltaGrid();
    for (var i = 0; i < deltas.Results.length; i++) {
        var delta = deltas.Results[i];
        store.Add(delta);
    }
    // Display 
    var columns = store.GetColumns();
    {
        var t = $('<thead>').append($('<tr>'));
        for (var i = 0; i < columns.length; i++) {
            var columnName = columns[i];
            var tCell1 = $('<td>').text(columnName);
            t = t.append(tCell1);
        }
        $('#deltaGrid').append(t);
    }
    for (var recId in store._map) {
        var data = store._map[recId];
        var tr = $('<tr>');
        var td = $('<td>').text(recId);
        tr = tr.append(td);
        for (var i = 1; i < columns.length; i++) {
            var columnName = columns[i];
            var val2 = data[columnName]; // or undefined if missing 
            var highlight = false;
            var deltaList = [];
            if (val2 != undefined) {
                deltaList = store.GetDeltasPerCel(recId, columnName);
                var numChanges = deltaList.length;
                if (numChanges > 1) {
                    val2 += " [" + deltaList.length + " changes]";
                }
                var usersPerCell = store.GetUserCountPerCel(recId, columnName);
                if (usersPerCell > 1) {
                    val2 += " [users: " + usersPerCell + "]";
                    highlight = true;
                }
            }
            var td = $('<td>').text(val2);
            if (highlight) {
                td.css("color", "red");
            }
            // When a cell is clicked, show the list 
            td.click(getFXOnClickCellShowDeltas(deltaList, recId, columnName));
            tr = tr.append(td);
        }
        $('#deltaGrid').append(tr);
    }
}
// Helper function to give each instance of the handle it's own copy of the parameters.
// Else the closures will all share the same parameter value. 
function getFXOnClickCellShowDeltas(deltaList, recId, columnName) {
    return function () {
        onClickCellShowDeltas(deltaList, recId, columnName);
    };
}
// When a cell is clicked, show all the edits for that cell 
function onClickCellShowDeltas(deltaList, recId, columnName) {
    var root = $('#deltasPerCel');
    root.empty();
    var t = $('<tr>').append($('<td>').text('Version')).append($('<td>').text('User')).append($('<td>').text('App')).append($('<td>').text('Timestamp')).append($('<td>').text('Value'));
    root.append(t);
    for (var i in deltaList) {
        var delta = deltaList[i];
        // Extract this value from the delta 
        var dataColumn = delta.Value[columnName];
        var recIdColumn = delta.Value["RecId"];
        var prevValue;
        for (var i2 in recIdColumn) {
            if (recIdColumn[i2] == recId) {
                prevValue = dataColumn[i2];
                break;
            }
        }
        t = ($('<tr>')).append($('<td>').text(delta.Version)).append($('<td>').text(delta.User)).append($('<td>').text(delta.App)).append($('<td>').text(delta.Timestamp)).append($('<td>').text(prevValue));
        root.append(t);
    }
}
// $$$ also count # of unique records changed 
// Show chart of # of deltas per user. 
function renderPerUserCountDeltas(deltas) {
    var counts = {}; // User -->  # of deltas for that user
    for (var i = 0; i < deltas.Results.length; i++) {
        var delta = deltas.Results[i];
        var l = counts[delta.User];
        if (l == undefined) {
            l = 0;
        }
        l++;
        counts[delta.User] = l;
    }
    for (var user in counts) {
        var count = counts[user];
        var tr = $('<tr>').append($('<td>').text(user)).append($('<td>').text(count));
        $('#deltas').append(tr);
    }
}
//# sourceMappingURL=Blame.js.map