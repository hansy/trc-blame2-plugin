// TypeScript
// JScript functions for BasicList.Html. 
// This calls TRC APIs and binds to specific HTML elements from the page.  
/// <reference path="..\..\trc.ts" />
// Global reference to the current sheet;
var _sheet;
var _filters;
var _deltas;

// Startup function called by the plugin
function PluginMain(sheet) {
    _sheet = sheet;

    trcGetSheetDeltas(sheet, function (deltas) {
        _deltas = deltas;
        resetFilters();
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
        this._columnCounts = {}; // number of responses for each value of each column

        // column names that take on discrete values
        // useful for creating histogram of responses
        this._discreteColumns = ["Gender", "Supporter", "ResultofContact", "Party"];
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

    // Keeps a running total of identical responses for each value a columnName
    // can take on.
    DeltaGrid.prototype.AggregateResponses = function (columnName, value) {
        var l = this._columnCounts[columnName];

        if (l == undefined) {
            l = {};
            this._columnCounts[columnName] = l;
        }

        if (l[value] == undefined) {
            l[value] = 0;
        }

        l[value] += 1;
    }; 

    DeltaGrid.prototype.IsDiscreteColumn = function(columnName) {
        if (this._discreteColumns.indexOf(columnName) >= 0) {
            return true;
        }
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
                    if (this.IsDiscreteColumn(columnName)) {
                        this.AggregateResponses(columnName, columnData[rowId]);
                    }
                    
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

function applyFilters() {
    $('#deltaGrid').empty();
    $('#deltasPerCel').empty();

    startLoading();
    renderDeltas(_deltas);
    finishLoading();
}

// shows loading indicator
function startLoading() {
    $('#loadingIndicator').addClass('loading');
}

// hides loading indicator
function finishLoading() {
    $('#loadingIndicator').removeClass("loading");
}

// returns true if delta meets _filters criteria; false otherwise
function isFiltered(delta) {
    for (filter in _filters) {
        if (filter === "User") {
            var deltaUser  = delta[filter]
            var filterUser = _filters[filter];

            if (filterUser != "" && filterUser != deltaUser) {
                return false;
            }
        } else if (filter === "Timestamp") {
            var deltaDate   = delta[filter];
            var filterStart = _filters[filter]["StartDate"];
            var filterEnd   = _filters[filter]["EndDate"];

            if (filterStart != "" && filterStart > deltaDate) {
                return false;
            } 

            if (filterEnd != "" && filterEnd < deltaDate) {
                return false;
            } 
        } 
    }

    return true;
}

function renderHistoryGrid(store) {
    var columns = store.GetColumns();

    {
        var thead = $('<thead>');
        var tr    = $('<tr>');
        for (var i = 0; i < columns.length; i++) {
            var columnName = columns[i];
            var tCell1 = $('<th>').text(columnName);
            tr = tr.append(tCell1);
        }
        $('#deltaGrid').append(thead).append(tr);
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
            var td = $('<td>');
            td.text(val2);
            if (columnName != "RecId") {
                td.addClass('clickable');
            }
            
            if (highlight) {
                td.addClass('danger');
            }
            // When a cell is clicked, show the list 
            td.click(getFXOnClickCellShowDeltas(deltaList, recId, columnName));
            tr = tr.append(td);
        }
        $('#deltaGrid').append(tr);
    }
}

function renderResponsesHistogram(store) {
    var numCategories = 0;
    var columnCounts  = store._columnCounts;

    for (var k in columnCounts) {
        if (columnCounts.hasOwnProperty(k)) {
           ++numCategories;
        }
    }

    if (numCategories != 0) {
        var numDivCol = calculateNumColToRender(numCategories);
        var div = document.getElementById('responsesHistograms');

        for (category in columnCounts) {
            // create Bootstrap column
            var col = document.createElement('div');
            col.setAttribute('class', "col-sm-12 col-md-"+numDivCol);
            div.appendChild(col);

            // add chart title
            var title = document.createElement('h4');
            title.innerHTML = category;
            title.setAttribute('class', 'bar-chart-title');
            col.appendChild(title);

            // create div to render canvas inside
            var canvasDiv = document.createElement('div');
            var canvasId  = category + "Histogram";
            canvasDiv.setAttribute('id', canvasId);
            col.appendChild(canvasDiv);

            // get responses
            var responses = columnCounts[category];
            window.responses = responses;
            var labels    = Object.keys(responses);
            var values    = [];

            for (key in responses) {
                values.push(responses[key]);
            }

            addBarChart(canvasId, labels, values, randomColor(), doNothing);
        }
        
    }
}

// placeholder function
function doNothing(canvas) {
    return function(event) {
    }
}

// Calculates the number of columns to render inside a row
// Twitter Bootstrap uses a grid system of 12 columns, so 
// based on number of categories to show, figure out how many
// columns to create
function calculateNumColToRender(total) {
    return Math.ceil(12/total);
}

// Show compressed grid of just the deltas provided. 
function renderDeltas(deltas) {
    var store          = new DeltaGrid();
    var filteredDeltas = { "Results":[] };

    for (var i = 0; i < deltas.Results.length; i++) {
        var delta = deltas.Results[i];
        if (isFiltered(delta)) {
            store.Add(delta);
            filteredDeltas.Results.push(delta);
        }
    }

    renderHistoryGrid(store);
    renderPerUserCountDeltasChart(filteredDeltas);
    renderResponsesHistogram(store);
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
    var t = $('<tr>').append($('<th>').text('Version')).append($('<th>').text('User')).append($('<th>').text('App')).append($('<th>').text('Timestamp')).append($('<th>').text('Value'));
    root.append($('<thead>')).append(t);
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

function deltaCountPerUser(deltas) {
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

    return counts;
}
// $$$ also count # of unique records changed 
// Show chart of # of deltas per user. 
function renderPerUserCountDeltas(deltas) {
    var counts = deltaCountPerUser(deltas);

    for (var user in counts) {
        var count = counts[user];
        var tr = $('<tr>').append($('<td>').text(user)).append($('<td>').text(count));
        $('#deltas').append(tr);
    }
}

function renderPerUserCountDeltasChart(deltas) {
    var counts = deltaCountPerUser(deltas);
    var labels = [];
    var values = [];

    for (var user in counts) {
        var count = counts[user];
        labels.push(user);
        values.push(count);
    }

    addBarChart('deltasPerUserBarChart', labels, values, randomColor(), getFxOnClickBarChart);
}

function addBarChart(domId, labels, values, fillColor, clickFx) {
    var data = {
        labels: labels,
        datasets: [
            {
                fillColor: fillColor,
                data: values
            }
        ]
    }

    var options = {
        barShowStroke: false,
        scaleShowLabels : true
    }

    var div = document.getElementById(domId);
    var canvas;

    // make sure not to keep appending new canvases to div
    if (div.children.length === 0) {
        canvas = document.createElement("canvas");
        div.appendChild(canvas);
    } else {
        canvas = div.children[0];
    }
    
    var ctx   = canvas.getContext("2d");
    var chart = new Chart(ctx).Bar(data, options); // add bar chart

    // add event when bars on chart are clicked
    canvas.onclick = clickFx(chart);  
}

function getFxOnClickBarChart(chart) {
    return function(event) {
        var activeBars = chart.getBarsAtEvent(event);

        if (activeBars[0] != undefined) {
            _filters["Name"] = activeBars[0].label;
        } else {
            _filters["Name"] = "";
        }
        
        applyFilters();
    }
}

// dateFields is array of objects { name => String, value => String }
// where name is 'startDate' or 'endDate' and value is a unix timestamp
function applyDateFilter(dateFields) {
    for (i=0; i < dateFields.length; i++) {
        var dateField = dateFields[i];

        if (dateField.value === "") {
            _filters["Timestamp"][dateField.name] = ""; // set empty value
        } else {
            var date = new Date(dateField.value);
            _filters["Timestamp"][dateField.name] = date.toISOString();
        }
    }

    applyFilters();
}


$('#dateFilterForm').on('submit', function(e) {
    e.preventDefault();
    var dateFields = $(this).serializeArray();

    if (_sheet === undefined) {
        alert('Please load sheet first');
    } else {
        applyDateFilter(dateFields);
    }
    
});

$('#resetFiltersBtn').on('click', function(e) {
    e.preventDefault();
    resetFilters();
});

// sets filters back to default (blank) values, clears filter form, and applies
// re-render of data via applyFilters() function
function resetFilters() {
    _filters = { "Name":"", "Timestamp": { "StartDate":"", "EndDate":"" } };

    $('#dateFilterForm')[0].reset(); // reset form fields
    applyFilters(); 
}
//# sourceMappingURL=Blame.js.map