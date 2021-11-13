'use strict';

var tbApp = angular.module('taskboardApp', ['ui.sortable','checklist-model']);

tbApp.controller('taskboardController', function ($scope, $filter, $http, $interval) {

    var applMode;
    var outlookCategories;
    var outlookMailboxes;
    var noteItem;
    var timeout;
    var refresh;

    var hasReadState; hasReadState = false;
    var hasReadConfig; hasReadConfig = false;
    var hasReadVersion; hasReadVersion = false;

    const debug_mode = false;

    const APP_MODE = 0;
    const CONFIG_MODE = 1;
    const HELP_MODE = 2;

    const STATE_ID = "KanbanState";
    const CONFIG_ID = "KanbanConfig";
    const LOG_ID = "KanbanErrorLog";

    const SOMEDAY = 0;
    const BACKLOG = 1;
    const SPRINT = 2;
    const DOING = 3;
    const WAITING = 4;
    const DONE = 5;

    const MAX_LOG_ENTRIES = 1500;

    $scope.includeConfig = true;
    $scope.includeState = true;
    $scope.includeLog = false;

    $scope.privacyFilter =
        {
            all: { text: "Both", value: "0" },
            private: { text: "Private", value: "1" },
            public: { text: "Work", value: "2" }
        };
    $scope.display_message = false;

    $scope.taskFolders = [
        { type: 0 },
        { type: 1 },
        { type: 2 },
        { type: 3 },
        { type: 4 },
        { type: 5 }
    ];

    $scope.switchToAppMode = function () {
        applMode = APP_MODE;
    }

    $scope.switchToConfigMode = function () {
        applMode = CONFIG_MODE;
    }

    $scope.switchToHelpMode = function () {
        applMode = HELP_MODE;
    }   

    $scope.inAppMode = function () {
        return applMode === APP_MODE;
    }

    $scope.inConfigMode = function () {
        return applMode === CONFIG_MODE;
    }

    $scope.inHelpMode = function () {
        return applMode === HELP_MODE;
    }

    $scope.init = function () {
        setUrls();

        $scope.isBrowserSupported = checkBrowser();
        if (!$scope.isBrowserSupported) {
            return;
        }

        noteItem = newNoteItem();

        $scope.installFolder = getOutlookTodayHomePageFolder();
        $scope.where = '';
        if ($scope.installFolder.indexOf('janware.nl') > -1) {
            $scope.where = '(online)'
        }
        else {
            $scope.where = '(offline)'
        }

        $scope.switchToAppMode();

        // watch search filter and apply it
        $scope.$watchGroup(['filter.search', 'filter.private', 'filter.category'], function (newValues, oldValues) {
            var isSearchChanged = (newValues[0] != oldValues[0]);
            var isPrivateChanged = (newValues[1] != oldValues[1]); 
            var isCategoryChanged = (newValues[2] != oldValues[2]); 
            if (isSearchChanged || isPrivateChanged || isCategoryChanged) {
                $scope.applyFilters();
                saveState();
            }
        });

        $scope.$watch('filter.mailbox', function (newValue, oldValue) {
            if (newValue != oldValue) {
                $scope.wipeTasks();
                $scope.initTasks();
                saveState();
            }
        });

        $scope.$watchGroup(['config.AUTO_REFRESH','config.AUTO_REFRESH_MINUTES'], function (newValues, oldvLaues) {
            if ($scope.config.AUTO_REFRESH_MINUTES < 1) {
                $scope.config.AUTO_REFRESH_MINUTES = 1;
            }
            if (refresh != undefined) {
                $interval.cancel(refresh);
            }
            refresh = $interval( function () {
                if ($scope.config.AUTO_REFRESH) {
                    $scope.refreshTasks();
                }
            }, $scope.config.AUTO_REFRESH_MINUTES * 60000);
        });

        $scope.categories = ["<All Categories>", "<No Category>"];
        outlookCategories = getOutlookCategories();
        outlookCategories.names.forEach(function (name) {
            $scope.categories.push(name);
        });
        $scope.categories = $scope.categories.sort();

        $scope.mailboxes = [];
        outlookMailboxes = getOutlookMailboxes(true);
        outlookMailboxes.forEach(function (box) {
            $scope.mailboxes.push(box);
        });

        readConfig();
        applyConfig();
        readState();
        readVersion();

        $scope.displayFolderCount = 0;
        $scope.taskFolders.forEach(function (folder) {
            if (folder.display) $scope.displayFolderCount++;
        });

         // ui-sortable options and events
        $scope.sortableOptions = {
            connectWith: '.tasklist',
            items: 'li',
            opacity: 0.5,
            cursor: 'move',
            containment: 'document',

            stop: function (e, ui) {
                try {
                    if (ui.item.sortable.droptarget) { // check if it is dropped on a valid target
                        var folderFrom;
                        var folderTo;
                        for (var i = SOMEDAY; i <= DONE ; i++) {
                           if (ui.item.sortable.source.attr('id') === ('folder-' + i)) folderFrom = i;
                           if (ui.item.sortable.droptarget.attr('id') === ('folder-' + i)) folderTo = i;
                        }
                        if (folderFrom !== folderTo) {
                            if ($scope.taskFolders[folderTo].limit !== 0
                                && $scope.taskFolders[folderTo].tasks.length > $scope.taskFolders[folderTo].limit) {
                                alert('Sorry, you reached the defined limit of this folder')
                                ui.item.sortable.cancel();
                            } else {
                                var newfolder = getTaskFolder($scope.filter.mailbox, $scope.taskFolders[folderTo].name);
                                var newstatus = $scope.taskFolders[folderTo].initialStatus;

                                // locate the task in outlook namespace by using unique entry id
                                var taskitem = getTaskItem(ui.item.sortable.model.entryID);

                                // set new status, if different
                                if (taskitem.Status != newstatus) {
                                    taskitem.Status = newstatus;
                                    taskitem.Save();
                                    ui.item.sortable.model.status = taskStatusText(newstatus);
                                    ui.item.sortable.model.completeddate = new Date(taskitem.DateCompleted)
                                }

                                // move the task item if it has to go another Outlook tasks folder
                                if (newfolder != $scope.taskFolders[folderFrom].name) {
                                    taskitem = taskitem.Move(newfolder);
                                }

                                // update entryID with new one (entryIDs get changed after move)
                                // https://msdn.microsoft.com/en-us/library/office/ff868618.aspx
                                ui.item.sortable.model.entryID = taskitem.EntryID;
                            }

                            $scope.getTasks(folderFrom, true);
                            $scope.getTasks(folderTo, true);
                            $scope.applyFilters();
                        }
                    }
                } catch (error) {
                    writeLog('drag and drop: ' + error)
                }
            }
        };

       $scope.initTasks();
    };

    $scope.submitConfig = function () {
        try {
            saveConfig();
            $scope.init();
            $scope.switchToAppMode();
        } catch (error) {
            writeLog('submitConfig: ' + error)
        }
    }

    // borrowed from http://stackoverflow.com/a/30446887/942100
    var fieldSorter = function (fields) {
        try {
            return function (a, b) {
                return fields
                    .map(function (o) {
                        var dir = 1;
                        if (o[0] === '-') {
                            dir = -1;
                            o = o.substring(1);
                        }
                        var propOfA = a[o];
                        var propOfB = b[o];

                        //string comparisons shall be case insensitive
                        if (typeof propOfA === "string") {
                            propOfA = propOfA.toUpperCase();
                            propOfB = propOfB.toUpperCase();
                        }

                        if (propOfA > propOfB) return dir;
                        if (propOfA < propOfB) return -(dir);
                        return 0;
                    }
                    ).reduce(function firstNonZeroValue(p, n) {
                        return p ? p : n;
                    }, 0
                    );
            };
        } catch (error) {
            writeLog('fieldSorter: ' + error)
        }
    };

    var getTasksFromOutlook = function (path, sort, folderStatus, ignoreStatus) {
        try {
            var i, j, cats, array = [];
            var tasks = getTaskItems($scope.filter.mailbox, path);

            var count = tasks.Count;
            for (i = 1; i <= count; i++) {
                var task = tasks(i);
                if (task.Status == folderStatus || ignoreStatus == true) {
                    array.push({
                        entryID: task.EntryID,
                        subject: task.Subject,
                        priority: task.Importance,
                        startdate: new Date(task.StartDate),
                        duedate: new Date(task.DueDate),
                        sensitivity: task.Sensitivity,
                        categories: getCategoryStyles(task.Categories),
                        notes: taskBodyNotes(task.Body, $scope.config.TASKNOTE_MAXLEN),
                        status: taskStatusText(task.Status),
                        oneNoteTaskID: getUserProperty(tasks(i), "OneNoteTaskID"),
                        oneNoteURL: getUserProperty(tasks(i), "OneNoteURL"),
                        completeddate: new Date(task.DateCompleted),
                        percent: task.PercentComplete,
                        owner: task.Owner,
                        totalwork: task.TotalWork,
                    });
                }
                cats = task.Categories.split(/[;,]+/);
                for (j=0; j < cats.length; j++) {
                    cats[j] = cats[j].trim();
                    if (cats[j].length > 0) {
                        if ($scope.activeCategories.indexOf(cats[j]) === -1) {
                            $scope.activeCategories.push(cats[j]);
                        }
                    }
                }
            };

            // sort tasks
            var sortKeys;
            if (sort === undefined) { sortKeys = ["-priority"]; }
            else { sortKeys = sort.split(","); }

            var sortedTasks = array.sort(fieldSorter(sortKeys));

            return sortedTasks;
        } catch (error) {
            writeLog('getTasksFromOutlook: ' + error)
        }
    };

    $scope.openOneNoteURL = function (url) {
        try {
            window.event.returnValue = false;
            if (navigator.msLaunchUri) {
                navigator.msLaunchUri(url);
            } else {
                window.open(url, "_blank").close();
            }
            return false;
        } catch (error) {
            writeLog('openOneNoteURL: ' + error)
        }
    }
    
    $scope.readTasks = function () {
        try {
            $scope.taskFolders.forEach(function (taskFolder) {
                if (taskFolder.display === true) {
                    $scope.getTasks(taskFolder.type, false);
                }
            });
        } catch (error) {
            writeLog('readTasks: '+ error)
        }
    }

    $scope.wipeTasks = function () {
        try {
            $scope.taskFolders.forEach(function (taskFolder) {
                $scope.taskFolders[taskFolder.type].tasks = undefined;
            })
        } catch (error) {
            writeLog('wipeTasks: '+ error)
        }
    } 
    
    $scope.refreshTasks = function () {
        $scope.wipeTasks();
        $scope.initTasks();
    }

    $scope.getTasks = function (type, reread) {
        try {
           if (typeof $scope.taskFolders[type].tasks === 'undefined' || reread == true) {
               var name = $scope.taskFolders[type].name;
               var sort = $scope.taskFolders[type].sort;
               var initialStatus = $scope.taskFolders[type].initialStatus;
               var ignoreStatus = false;
               if (type == SOMEDAY || type == BACKLOG) ignoreStatus = true;
               $scope.taskFolders[type].tasks = getTasksFromOutlook(name, sort, initialStatus, ignoreStatus);
               $scope.taskFolders[type].filteredTasks = $scope.taskFolders[type].tasks;
           }
        } catch (error) {
            writeLog("getTasks: " + error)
        }
    }

    $scope.initTasks = function () {
        try {
            if (typeof $scope.activeCategories === 'undefined') {
                $scope.activeCategories = ["<All Categories>", "<No Category>"];
            }
            $scope.readTasks();
            $scope.activeCategories = $scope.activeCategories.sort();
            // then apply the current filters for search and sensitivity
            $scope.applyFilters();
            // clean up Completed Tasks
            if ($scope.config.COMPLETED.ACTION == 'ARCHIVE' || $scope.config.COMPLETED.ACTION == 'DELETE') {
                var i;
                $scope.getTasks(DONE, false);
                var tasks = $scope.taskFolders[DONE].tasks;
                var count = tasks.length;
                for (i = 0; i < count; i++) {
                    try {
                        var days = Date.daysBetween(tasks[i].completeddate, new Date());
                        if (days > $scope.config.COMPLETED.AFTER_X_DAYS) {
                            if ($scope.config.COMPLETED.ACTION == 'ARCHIVE') {
                                $scope.archiveTask(tasks[i], $scope.taskFolders[DONE].tasks, $scope.taskFolders[DONE].filteredTasks);
                            }
                            if ($scope.config.COMPLETED.ACTION == 'DELETE') {
                                $scope.deleteTask(tasks[i], $scope.taskFolders[DONE].tasks, $scope.taskFolders[DONE].filteredTasks, false);
                            }
                        };
                    } catch (error) {
                        // ignore errors at this point. 
                    }
                };
            };
            // move tasks that do not have status New to the Next folder
            if (true) {
                var i;
                var movedTask = false;
                $scope.getTasks(BACKLOG, false)
                $scope.getTasks(SPRINT, false)
                var tasks = $scope.taskFolders[BACKLOG].tasks;
                var count = tasks.length;
                var moved = 0;
                for (i = 0; i < count; i++) {
                    if (tasks[i].status != $scope.config.STATUS.NOT_STARTED.TEXT) {
                        var taskitem = getTaskItem(tasks[i].entryID);
                        taskitem.Move(getTaskFolder($scope.filter.mailbox, $scope.taskFolders[SPRINT].name));
                        movedTask = true;
                        moved++;
                    }
                };
                if (movedTask) {
                    $scope.getTasks(BACKLOG, true)
                    $scope.getTasks(SPRINT, true)
                    $scope.applyFilters();
                }
            }
            // move tasks with start date today to the Next folder
            if ($scope.config.AUTO_START_TASKS) {
                var i;
                var movedTask = false;
                $scope.getTasks(BACKLOG, false)
                $scope.getTasks(SPRINT, false)
                var tasks = $scope.taskFolders[BACKLOG].tasks;
                var count = tasks.length;
                var moved = 0;
                for (i = 0; i < count; i++) {
                    if (tasks[i].startdate.getFullYear() != 4501) {
                        var seconds = Date.secondsBetween(tasks[i].startdate, new Date());
                        if (seconds >= 0) {
                            var taskitem = getTaskItem(tasks[i].entryID);
                            taskitem.Move(getTaskFolder($scope.filter.mailbox, $scope.taskFolders[SPRINT].name));
                            movedTask = true;
                            moved++;
                        }
                    };
                };
                if (movedTask) {
                    $scope.getTasks(BACKLOG, true)
                    $scope.getTasks(SPRINT, true)
                    $scope.applyFilters();
                }
            }
            // move tasks with past due date to the Next folder
            if ($scope.config.AUTO_START_DUE_TASKS) {
                var i;
                var movedTask = false;
                $scope.getTasks(BACKLOG, false)
                $scope.getTasks(SPRINT, false)
                var tasks = $scope.taskFolders[BACKLOG].tasks;
                var count = tasks.length;
                var moved = 0;
                for (i = 0; i < count; i++) {
                    if (tasks[i].duedate.getFullYear() != 4501) {
                        var seconds = Date.secondsBetween(tasks[i].duedate, new Date());
                        if (seconds >= 0) {
                            var taskitem = getTaskItem(tasks[i].entryID);
                            taskitem.Move(getTaskFolder($scope.filter.mailbox, $scope.taskFolders[SPRINT].name));
                            movedTask = true;
                            moved++;
                        }
                    };
                };
                if (movedTask) {
                    $scope.getTasks(BACKLOG, true)
                    $scope.getTasks(SPRINT, true)
                    $scope.applyFilters();
                }
            }
            // move tasks with start date in future back to the Backlog folder
            if (true) {
                var i;
                var movedTask = false;
                $scope.getTasks(BACKLOG, false)
                $scope.getTasks(SPRINT, false)
                var tasks = $scope.taskFolders[SPRINT].tasks;
                var count = tasks.length;
                var moved = 0;
                for (i = 0; i < count; i++) {
                    if (tasks[i].startdate.getFullYear() != 4501) {
                        var seconds = Date.secondsBetween(new Date(), tasks[i].startdate);
                        if (seconds >= 0) {
                            var taskitem = getTaskItem(tasks[i].entryID);
                            taskitem.Move(getTaskFolder($scope.filter.mailbox, $scope.taskFolders[BACKLOG].name));
                            movedTask = true;
                            moved++;
                        }
                    };
                };
                if (movedTask) {
                    $scope.getTasks(BACKLOG, true)
                    $scope.getTasks(SPRINT, true)
                    $scope.applyFilters();
                }
            }
        } catch (error) {
            writeLog('initTasks: ' + error)
        }
    };

    function var_dump(object, returnString) {
        var returning = '';
        for (var element in object) {
            var elem = object[element];
            if (typeof elem == 'object') {
                elem = var_dump(object[element], true);
            }
            returning += element + ': ' + elem + '\n';
        }
        if (returning == '') {
            returning = 'Empty object';
        }
        if (returnString === true) {
            return returning;
        }
        alert(returning);
    }

    $scope.applyFilters = function () {
        try {
            readState();

            if ($scope.filter.search.length > 0) {
                $scope.taskFolders.forEach(function (taskFolder) {
                    taskFolder.filteredTasks = $filter('filter')(taskFolder.tasks, $scope.filter.search);
                });
            }
            else {
                $scope.taskFolders.forEach(function (taskFolder) {
                    taskFolder.filteredTasks = taskFolder.tasks;
                });
            }

            if ($scope.filter.category != "<All Categories>") {
                if ($scope.filter.category == "<No Category>") {
                    $scope.taskFolders.forEach(function (taskFolder) {
                        taskFolder.filteredTasks = $filter('filter')(taskFolder.filteredTasks, function (task) {
                            return task.categories == '';
                        });
                    });
                }
                else {
                    $scope.taskFolders.forEach(function (taskFolder) {
                        taskFolder.filteredTasks = $filter('filter')(taskFolder.filteredTasks, function (task) {
                            if (task.categories == '') {
                                return false;
                            }
                            else {
                                for (var i = 0; i < task.categories.length; i++) {
                                    var cat = task.categories[i];
                                    if (cat.label == $scope.filter.category) {
                                        return true;
                                    }
                                }
                                return false;
                            }
                        });
                    });
                }
            }

            // I think this can be written shorter, but for now it works
            var sensitivityFilter;
            if ($scope.filter.private != $scope.privacyFilter.all.value) {
                if ($scope.filter.private == $scope.privacyFilter.private.value) { sensitivityFilter = SENSITIVITY.olPrivate; }
                if ($scope.filter.private == $scope.privacyFilter.public.value) { sensitivityFilter = SENSITIVITY.olNormal; }
                $scope.taskFolders.forEach(function (taskFolder) {
                    taskFolder.filteredTasks = $filter('filter')(taskFolder.filteredTasks, function (task) { return task.sensitivity == sensitivityFilter });
                });
            }

            // filter on start date
            $scope.taskFolders.forEach(function (taskFolder) {
                if (taskFolder.filterOnStartDate === true) {
                    taskFolder.filteredTasks = $filter('filter')(taskFolder.filteredTasks, function (task) {
                        if (task.startdate.getFullYear() != 4501) {
                            var days = Date.daysBetween(task.startdate, new Date());
                            return days >= 0;
                        }
                        else return true; // always show tasks not having start date
                    });
                }
            });

            // filter completed tasks if the HIDE options is configured
            if ($scope.config.COMPLETED.ACTION == 'HIDE') {
                $scope.taskFolders[DONE].filteredTasks = $filter('filter')($scope.taskFolders[DONE].filteredTasks, function (task) {
                    var days = Date.daysBetween(task.completeddate, new Date());
                    return days < $scope.config.COMPLETED.AFTER_X_DAYS;
                });
            }

			// filter backlog tasks to show only NOT STARTED
			if ('folder-' + BACKLOG){
				$scope.taskFolders[BACKLOG].filteredTasks = $filter('filter')($scope.taskFolders[BACKLOG].filteredTasks, function (task) {
					return task.status == "Not Started";
				});
			}

        } catch (error) {
            writeLog('applyFilters: ' + error)
        }
    }

    function closeDisplayLink () {
        noteItem.GetInspector().Close(1);
    }

    $scope.displayLink = function (link) {
    try {
        noteItem.Body = "Click here to open the link in your default browser: " + link;
        noteItem.GetInspector().Activate();
        if (timeout != undefined) { clearTimeout(timeout); }
        timeout = setTimeout(closeDisplayLink, 7000);
        } catch(e) { alert(e)}

    }   

    $scope.sendFeedback = function (includeConfig, includeState, includeLog) {
        try {
            var mailItem = newMailItem();
            mailItem.Subject = "JanBan version " + $scope.version + " Feedback (Outlook version: " + getOutlookVersion() + ")";
            mailItem.To = "janban@papasmurf.nl";
            mailItem.BodyFormat = 2;
            if (includeConfig) {
                mailItem.Attachments.Add(getPureJournalItem(CONFIG_ID));
            }
            if (includeState) {
                mailItem.Attachments.Add(getPureJournalItem(STATE_ID));
            }
            if (includeLog) {
                mailItem.Attachments.Add(getPureJournalItem(LOG_ID));
            }
            mailItem.Display();
        } catch (error) {
            writeLog('sendFeedback: ' + error)
        }
    }

    // this is only a proof-of-concept single page report in a draft email for weekly report
    // it will be improved later on
    $scope.createReport = function () {
        try {
            var i;
            var mailItem, mailBody;
            mailItem = newMailItem();
            mailItem.Subject = "Status Report";
            mailItem.BodyFormat = 2;

            mailBody = "<style>";
            mailBody += "body { font-family: Calibri; font-size:11.0pt; } ";
            //mailBody += " h3 { font-size: 11pt; text-decoration: underline; } ";
            mailBody += " </style>";
            mailBody += "<body>";

            // COMPLETED ITEMS
            if ($scope.config.COMPLETED_FOLDER.REPORT.DISPLAY) {
                var tasks = getTaskFolder($scope.filter.mailbox, $scope.config.COMPLETED_FOLDER.NAME).Items.Restrict("[Complete] = true And Not ([Sensitivity] = 2)");
                tasks.Sort("[Importance][Status]", true);
                mailBody += "<h3>" + $scope.config.COMPLETED_FOLDER.TITLE + "</h3>";
                mailBody += "<ul>";
                var count = tasks.Count;
                for (i = 1; i <= count; i++) {
                    mailBody += "<li>"
                    if (tasks(i).Categories !== "") { mailBody += "[" + tasks(i).Categories + "] "; }
                    mailBody += "<strong>" + tasks(i).Subject + "</strong>" + " - <i>" + taskStatusText(tasks(i).Status) + "</i>";
                    if ($scope.config.COMPLETED_FOLDER.DISPLAY_PROPERTIES.TOTALWORK) { mailBody += " - " + tasks(i).TotalWork + " mn "; }
                    if (tasks(i).Importance == 2) { mailBody += "<font color=red> [H]</font>"; }
                    if (tasks(i).Importance == 0) { mailBody += "<font color=gray> [L]</font>"; }
                    var dueDate = new Date(tasks(i).DueDate);
                    if (moment(dueDate).isValid && moment(dueDate).year() != 4501) { mailBody += " [Due: " + moment(dueDate).format("DD-MMM") + "]"; }
                    if (taskBodyNotes(tasks(i).Body, 10000)) { mailBody += "<br>" + "<font color=gray>" + taskBodyNotes(tasks(i).Body, 10000) + "</font>"; }
                    mailBody += "</li>";
                }
                mailBody += "</ul>";
            }

            // INPROGRESS ITEMS
            if ($scope.config.INPROGRESS_FOLDER.REPORT.DISPLAY) {
                var tasks = getTaskFolder($scope.filter.mailbox, $scope.config.INPROGRESS_FOLDER.NAME).Items.Restrict("[Status] = 1 And Not ([Sensitivity] = 2)");
                tasks.Sort("[Importance][Status]", true);
                mailBody += "<h3>" + $scope.config.INPROGRESS_FOLDER.TITLE + "</h3>";
                mailBody += "<ul>";
                var count = tasks.Count;
                for (i = 1; i <= count; i++) {
                    mailBody += "<li>"
                    if (tasks(i).Categories !== "") { mailBody += "[" + tasks(i).Categories + "] "; }
                    mailBody += "<strong>" + tasks(i).Subject + "</strong>" + " - <i>" + taskStatusText(tasks(i).Status) + "</i>";
                    if ($scope.config.INPROGRESS_FOLDER.DISPLAY_PROPERTIES.TOTALWORK) { mailBody += " - " + tasks(i).TotalWork + " mn "; }
                    if (tasks(i).Importance == 2) { mailBody += "<font color=red> [H]</font>"; }
                    if (tasks(i).Importance == 0) { mailBody += "<font color=gray> [L]</font>"; }
                    var dueDate = new Date(tasks(i).DueDate);
                    if (moment(dueDate).isValid && moment(dueDate).year() != 4501) { mailBody += " [Due: " + moment(dueDate).format("DD-MMM") + "]"; }
                    if (taskBodyNotes(tasks(i).Body, 10000)) { mailBody += "<br>" + "<font color=gray>" + taskBodyNotes(tasks(i).Body, 10000) + "</font>"; }
                    mailBody += "</li>";
                }
                mailBody += "</ul>";
            }

            // NEXT ITEMS
            if ($scope.config.NEXT_FOLDER.REPORT.DISPLAY) {
                var tasks = getTaskFolder($scope.filter.mailbox, $scope.config.NEXT_FOLDER.NAME).Items.Restrict("[Status] = 0 And Not ([Sensitivity] = 2)");
                tasks.Sort("[Importance][Status]", true);
                mailBody += "<h3>" + $scope.config.NEXT_FOLDER.TITLE + "</h3>";
                mailBody += "<ul>";
                var count = tasks.Count;
                for (i = 1; i <= count; i++) {
                    mailBody += "<li>"
                    if (tasks(i).Categories !== "") { mailBody += "[" + tasks(i).Categories + "] "; }
                    mailBody += "<strong>" + tasks(i).Subject + "</strong>" + " - <i>" + taskStatusText(tasks(i).Status) + "</i>";
                    if ($scope.config.NEXT_FOLDER.DISPLAY_PROPERTIES.TOTALWORK) { mailBody += " - " + tasks(i).TotalWork + " mn "; }
                    if (tasks(i).Importance == 2) { mailBody += "<font color=red> [H]</font>"; }
                    if (tasks(i).Importance == 0) { mailBody += "<font color=gray> [L]</font>"; }
                    var dueDate = new Date(tasks(i).DueDate);
                    if (moment(dueDate).isValid && moment(dueDate).year() != 4501) { mailBody += " [Due: " + moment(dueDate).format("DD-MMM") + "]"; }
                    if (taskBodyNotes(tasks(i).Body, 10000)) { mailBody += "<br>" + "<font color=gray>" + taskBodyNotes(tasks(i).Body, 10000) + "</font>"; }
                    mailBody += "</li>";
                }
                mailBody += "</ul>";
            }

            // WAITING ITEMS
            if ($scope.config.WAITING_FOLDER.REPORT.DISPLAY) {
                var tasks = getTaskFolder($scope.filter.mailbox, $scope.config.WAITING_FOLDER.NAME).Items.Restrict("[Status] = 3 And Not ([Sensitivity] = 2)");
                tasks.Sort("[Importance][Status]", true);
                mailBody += "<h3>" + $scope.config.WAITING_FOLDER.TITLE + "</h3>";
                mailBody += "<ul>";
                var count = tasks.Count;
                for (i = 1; i <= count; i++) {
                    mailBody += "<li>"
                    if (tasks(i).Categories !== "") { mailBody += "[" + tasks(i).Categories + "] "; }
                    mailBody += "<strong>" + tasks(i).Subject + "</strong>" + " - <i>" + taskStatusText(tasks(i).Status) + "</i>";
                    if ($scope.config.WAITING_FOLDER.DISPLAY_PROPERTIES.TOTALWORK) { mailBody += " - " + tasks(i).TotalWork + " mn "; }
                    if (tasks(i).Importance == 2) { mailBody += "<font color=red> [H]</font>"; }
                    if (tasks(i).Importance == 0) { mailBody += "<font color=gray> [L]</font>"; }
                    var dueDate = new Date(tasks(i).DueDate);
                    if (moment(dueDate).isValid && moment(dueDate).year() != 4501) { mailBody += " [Due: " + moment(dueDate).format("DD-MMM") + "]"; }
                    if (taskBodyNotes(tasks(i).Body, 10000)) { mailBody += "<br>" + "<font color=gray>" + taskBodyNotes(tasks(i).Body, 10000) + "</font>"; }
                    mailBody += "</li>";
                }
                mailBody += "</ul>";
            }

            // BACKLOG ITEMS
            if ($scope.config.BACKLOG_FOLDER.REPORT.DISPLAY) {
                var tasks = getTaskFolder($scope.filter.mailbox, $scope.config.BACKLOG_FOLDER.NAME).Items.Restrict("[Status] = 0 And Not ([Sensitivity] = 2)");
                tasks.Sort("[Importance][Status]", true);
                mailBody += "<h3>" + $scope.config.BACKLOG_FOLDER.TITLE + "</h3>";
                mailBody += "<ul>";
                var count = tasks.Count;
                for (i = 1; i <= count; i++) {
                    mailBody += "<li>"
                    if (tasks(i).Categories !== "") { mailBody += "[" + tasks(i).Categories + "] "; }
                    mailBody += "<strong>" + tasks(i).Subject + "</strong>" + " - <i>" + taskStatusText(tasks(i).Status) + "</i>";
                    if ($scope.config.BACKLOG_FOLDER.DISPLAY_PROPERTIES.TOTALWORK) { mailBody += " - " + tasks(i).TotalWork + " mn "; }
                    if (tasks(i).Importance == 2) { mailBody += "<font color=red> [H]</font>"; }
                    if (tasks(i).Importance == 0) { mailBody += "<font color=gray> [L]</font>"; }
                    var dueDate = new Date(tasks(i).DueDate);
                    if (moment(dueDate).isValid && moment(dueDate).year() != 4501) { mailBody += " [Due: " + moment(dueDate).format("DD-MMM") + "]"; }
                    if (taskBodyNotes(tasks(i).Body, 10000)) { mailBody += "<br>" + "<font color=gray>" + taskBodyNotes(tasks(i).Body, 10000) + "</font>"; }
                    mailBody += "</li>";
                }
                mailBody += "</ul>";
            }

            // SOMEDAY ITEMS
            if ($scope.config.SOMEDAY_FOLDER.REPORT.DISPLAY) {
                var tasks = getTaskFolder($scope.filter.mailbox, $scope.config.SOMEDAY_FOLDER.NAME).Items;
                tasks.Sort("[Importance][Status]", true);
                mailBody += "<h3>" + $scope.config.SOMEDAY_FOLDER.TITLE + "</h3>";
                mailBody += "<ul>";
                var count = tasks.Count;
                for (i = 1; i <= count; i++) {
                    mailBody += "<li>"
                    if (tasks(i).Categories !== "") { mailBody += "[" + tasks(i).Categories + "] "; }
                    mailBody += "<strong>" + tasks(i).Subject + "</strong>" + " - <i>" + taskStatusText(tasks(i).Status) + "</i>";
                    if ($scope.config.SOMEDAY_FOLDER.DISPLAY_PROPERTIES.TOTALWORK) { mailBody += " - " + tasks(i).TotalWork + " mn "; }
                    if (tasks(i).Importance == 2) { mailBody += "<font color=red> [H]</font>"; }
                    if (tasks(i).Importance == 0) { mailBody += "<font color=gray> [L]</font>"; }
                    var dueDate = new Date(tasks(i).DueDate);
                    if (moment(dueDate).isValid && moment(dueDate).year() != 4501) { mailBody += " [Due: " + moment(dueDate).format("DD-MMM") + "]"; }
                    if (taskBodyNotes(tasks(i).Body, 10000)) { mailBody += "<br>" + "<font color=gray>" + taskBodyNotes(tasks(i).Body, 10000) + "</font>"; }
                    mailBody += "</li>";
                }
                mailBody += "</ul>";
            }

            mailBody += "</body>"

            // include report content to the mail body
            mailItem.HTMLBody = mailBody;

            // only display the draft email
            mailItem.Display();
        } catch (error) {
            writeLog('createReport: ' + error)
        }
    };

    var taskBodyNotes = function (str, limit) {
        try {
            // remove empty lines, cut off text if length > limit
            str = str.replace(/^(?=\n)$|^\s*|\s*$|\n\n+/gm, '');
            str = str.replace('\r\n', '<br>');
            if (str.length > limit) {
                str = str.substring(0, str.lastIndexOf(' ', limit));
                if (limit != 0) { str = str + "..." }
            };
            return str;
        } catch (error) {
            writeLog('taskBodyNotes: ' + error)
        }
    };

    var taskStatusText = function (status) {
        try {
            if (status == $scope.config.STATUS.NOT_STARTED.VALUE) { return $scope.config.STATUS.NOT_STARTED.TEXT; }
            if (status == $scope.config.STATUS.IN_PROGRESS.VALUE) { return $scope.config.STATUS.IN_PROGRESS.TEXT; }
            if (status == $scope.config.STATUS.WAITING.VALUE) { return $scope.config.STATUS.WAITING.TEXT; }
            if (status == $scope.config.STATUS.COMPLETED.VALUE) { return $scope.config.STATUS.COMPLETED.TEXT; }
            return '';
        } catch (error) {
            writeLog('taskStatusText: ' + error)
        }
    };

    // create a new task under target folder
    $scope.addTask = function (target) {
        try {
            // set the parent folder to target defined
            switch (target) {
                case SOMEDAY:
                    var tasksfolder = getTaskFolder($scope.filter.mailbox, $scope.taskFolders[SOMEDAY].name);
                    break;
                case BACKLOG:
                    var tasksfolder = getTaskFolder($scope.filter.mailbox, $scope.taskFolders[BACKLOG].name);
                    break;
                case SPRINT:
                    var tasksfolder = getTaskFolder($scope.filter.mailbox, $scope.taskFolders[SPRINT].name);
                    break;
                case DOING:
                    var tasksfolder = getTaskFolder($scope.filter.mailbox, $scope.taskFolders[DOING].name);
                    break;
                case WAITING:
                    var tasksfolder = getTaskFolder($scope.filter.mailbox, $scope.taskFolders[WAITING].name);
                    break;
            };
            // create a new task item object in outlook
            var taskitem = tasksfolder.Items.Add();

            // set sensitivity according to the current filter
            if ($scope.filter.private == $scope.privacyFilter.private.value) {
                taskitem.Sensitivity = SENSITIVITY.olPrivate;
            }

            // display outlook task item window
            taskitem.Display();

            if ($scope.config.AUTO_UPDATE) {
                saveState();

                // bind to taskitem write event on outlook and reload the page after the task is saved
                eval("function taskitem::Write (bStat) {window.location.reload();  return true;}");
            }

            // for anyone wondering about this weird double colon syntax:
            // Office is using IE11 to launch custom apps.
            // This syntax is used in IE to bind events. 
            //(https://msdn.microsoft.com/en-us/library/ms974564.aspx?f=255&MSPPError=-2147217396)
            //
            // by using eval we can avoid any error message until it is actually executed by Microsofts scripting engine
        } catch (error) {
            writeLog('addTask: ' + error)
        }
    }

    // opens up task item in outlook
    // refreshes the taskboard page when task item window closed
    $scope.editTask = function (item) {
        try {
            if (item.status == $scope.config.STATUS.COMPLETED.TEXT) return;
            var taskitem = getTaskItem(item.entryID);
            taskitem.Display();
            if ($scope.config.AUTO_UPDATE) {
                saveState();
                // bind to taskitem write event on outlook and reload the page after the task is saved
                eval("function taskitem::Write (bStat) {window.location.reload(); return true;}");
                // bind to taskitem beforedelete event on outlook and reload the page after the task is deleted
                eval("function taskitem::BeforeDelete (bStat) {window.location.reload(); return true;}");
            }
        } catch (error) {
            writeLog('editTask: ' + error)
        }
    };

    // deletes the task item in both outlook and model data
    $scope.deleteTask = function (item, sourceArray, filteredSourceArray, bAskConfirmation) {
        try {
            var doDelete = true;
            if (bAskConfirmation) {
                doDelete = window.confirm('Are you absolutely sure you want to delete this item?');
            }
            if (doDelete) {
                // locate and delete the outlook task
                var taskitem = getTaskItem(item.entryID);
                taskitem.Delete();

                // locate and remove the item from the models
                removeItemFromArray(item, sourceArray);
                removeItemFromArray(item, filteredSourceArray);
            };
        } catch (error) {
            writeLog('deleteTask: ' + error)
        }
    };

    // moves the task item to the archive folder and marks it as complete
    // also removes it from the model data
    $scope.archiveTask = function (item, sourceArray, filteredSourceArray) {
        try {
            // locate the task in outlook namespace by using unique entry id
            var taskitem = getTaskItem(item.entryID);

            // move the task to the archive folder first (if it is not already in)
            var archivefolder = getTaskFolder($scope.filter.mailbox, $scope.config.ARCHIVE_FOLDER.NAME);
            if (taskitem.Parent.Name != archivefolder.Name) {
                taskitem = taskitem.Move(archivefolder);
            };

            // locate and remove the item from the models
            removeItemFromArray(item, sourceArray);
            removeItemFromArray(item, filteredSourceArray);
        } catch (error) {
            writeLog('archiveTask: ' + error)
        }
    };

    var removeItemFromArray = function (item, array) {
        try {
            var index = array.indexOf(item);
            if (index != -1) { array.splice(index, 1); }
        } catch (error) {
            writeLog('removeItemFromArray: ' + error)
        }
    };

    // checks whether the task date is overdue or today
    // returns class based on the result
    $scope.isOverdue = function (strdate) {
        try {
            var dateobj = new Date(strdate).setHours(0, 0, 0, 0);
            var today = new Date().setHours(0, 0, 0, 0);
            return { 'task-overdue': dateobj < today, 'task-today': dateobj == today };
        } catch (error) {
            writeLog('isOverdue: ' + error)
        }
    };

    $scope.getFooterStyle = function (categories) {
        try {
            if ($scope.config.USE_CATEGORY_COLOR_FOOTERS) {
                if ((categories !== '') && $scope.config.USE_CATEGORY_COLORS) {
                    // Copy category style
                    if (categories.length == 1) {
                        if (categories[0] == undefined) return undefined;
                        return categories[0].style;
                    }
                    // Make multi-category tasks light gray
                    else {
                        var lightGray = '#dfdfdf';
                        return { "background-color": lightGray, color: getContrastYIQ(lightGray) };
                    }
                }
            }
            return;
        } catch (error) {
            writeLog('getFooterStyle: ' + error)
        }
    };

    $scope.getTaskboardBackgroundColor = function () {
        try {
            if ($scope.config.DARK_MODE)
                return { "background-color": '#6a6a6a' }
        } catch (error) {
            writeLog('getTaskboardBackgroundColor: ' + error)
        }
    };

    $scope.getTasklistBackgroundColor = function () {
        try {
            if ($scope.config.DARK_MODE)
                return { "background-color": '#b2b2b2' }
            else
                return { "background-color": '#f5f5f5' }
        } catch (error) {
            writeLog('getTasklistBackgroundColor: ' + error)
        }
    };

    Date.daysBetween = function (date1, date2) {
        try {
            //Get 1 day in milliseconds
            var one_day = 1000 * 60 * 60 * 24;

            // Convert both dates to milliseconds
            var date1_ms = date1.getTime();
            var date2_ms = date2.getTime();

            // Calculate the difference in milliseconds
            var difference_ms = date2_ms - date1_ms;

            // Convert back to days and return
            return difference_ms / one_day;
        } catch (error) {
            writeLog('Date.daysbetween: ' + error)
        }
    }

    Date.secondsBetween = function (date1, date2) {
        try {
            //Get 1 second in milliseconds
            var one_second = 1000;

            // Convert both dates to milliseconds
            var date1_ms = date1.getTime();
            var date2_ms = date2.getTime();

            // Calculate the difference in milliseconds
            var difference_ms = date2_ms - date1_ms;

            // Convert back to seconds and return
            return difference_ms / one_second;
        } catch (error) {
            writeLog('Date.secondsBetween: ' + error)
        }
    }

    var applyConfig = function () {
        try {
            $scope.taskFolders[SOMEDAY].type = SOMEDAY;
            $scope.taskFolders[SOMEDAY].initialStatus = $scope.config.STATUS.NOT_STARTED.VALUE;
            $scope.taskFolders[SOMEDAY].display = $scope.config.SOMEDAY_FOLDER.ACTIVE;
            $scope.taskFolders[SOMEDAY].name = $scope.config.SOMEDAY_FOLDER.NAME;
            $scope.taskFolders[SOMEDAY].title = $scope.config.SOMEDAY_FOLDER.TITLE;
            $scope.taskFolders[SOMEDAY].limit = $scope.config.SOMEDAY_FOLDER.LIMIT;
            $scope.taskFolders[SOMEDAY].sort = $scope.config.SOMEDAY_FOLDER.SORT;
            $scope.taskFolders[SOMEDAY].displayOwner = $scope.config.SOMEDAY_FOLDER.DISPLAY_PROPERTIES.OWNER;
            $scope.taskFolders[SOMEDAY].displayPercent = $scope.config.SOMEDAY_FOLDER.DISPLAY_PROPERTIES.PERCENT;
            $scope.taskFolders[SOMEDAY].displayTotalWork = $scope.config.SOMEDAY_FOLDER.DISPLAY_PROPERTIES.TOTALWORK;
            $scope.taskFolders[SOMEDAY].displayStartDate = $scope.config.SOMEDAY_FOLDER.DISPLAY_PROPERTIES.STARTDATE;
            $scope.taskFolders[SOMEDAY].displayDueDate = $scope.config.SOMEDAY_FOLDER.DISPLAY_PROPERTIES.DUEDATE;
            $scope.taskFolders[SOMEDAY].filterOnStartDate = $scope.config.SOMEDAY_FOLDER.FILTER_ON_START_DATE;
            $scope.taskFolders[SOMEDAY].displayInReport = $scope.config.SOMEDAY_FOLDER.REPORT.DISPLAY;
            $scope.taskFolders[SOMEDAY].allowAdd = true;
            $scope.taskFolders[SOMEDAY].allowEdit = true;

            $scope.taskFolders[BACKLOG].type = BACKLOG;
            $scope.taskFolders[BACKLOG].initialStatus = $scope.config.STATUS.NOT_STARTED.VALUE;
            $scope.taskFolders[BACKLOG].display = $scope.config.BACKLOG_FOLDER.ACTIVE;
            $scope.taskFolders[BACKLOG].name = $scope.config.BACKLOG_FOLDER.NAME;
            $scope.taskFolders[BACKLOG].title = $scope.config.BACKLOG_FOLDER.TITLE;
            $scope.taskFolders[BACKLOG].limit = $scope.config.BACKLOG_FOLDER.LIMIT;
            $scope.taskFolders[BACKLOG].sort = $scope.config.BACKLOG_FOLDER.SORT;
            $scope.taskFolders[BACKLOG].displayOwner = $scope.config.BACKLOG_FOLDER.DISPLAY_PROPERTIES.OWNER;
            $scope.taskFolders[BACKLOG].displayPercent = $scope.config.BACKLOG_FOLDER.DISPLAY_PROPERTIES.PERCENT;
            $scope.taskFolders[BACKLOG].displayTotalWork = $scope.config.BACKLOG_FOLDER.DISPLAY_PROPERTIES.TOTALWORK;
            $scope.taskFolders[BACKLOG].displayStartDate = $scope.config.BACKLOG_FOLDER.DISPLAY_PROPERTIES.STARTDATE;
            $scope.taskFolders[BACKLOG].displayDueDate = $scope.config.BACKLOG_FOLDER.DISPLAY_PROPERTIES.DUEDATE;
            $scope.taskFolders[BACKLOG].filterOnStartDate = $scope.config.BACKLOG_FOLDER.FILTER_ON_START_DATE;
            $scope.taskFolders[BACKLOG].displayInReport = $scope.config.BACKLOG_FOLDER.REPORT.DISPLAY;
            $scope.taskFolders[BACKLOG].allowAdd = true;
            $scope.taskFolders[BACKLOG].allowEdit = true;

            $scope.taskFolders[SPRINT].type = SPRINT;
            $scope.taskFolders[SPRINT].initialStatus = $scope.config.STATUS.NOT_STARTED.VALUE;
            $scope.taskFolders[SPRINT].display = $scope.config.NEXT_FOLDER.ACTIVE;
            $scope.taskFolders[SPRINT].name = $scope.config.NEXT_FOLDER.NAME;
            $scope.taskFolders[SPRINT].title = $scope.config.NEXT_FOLDER.TITLE;
            $scope.taskFolders[SPRINT].limit = $scope.config.NEXT_FOLDER.LIMIT;
            $scope.taskFolders[SPRINT].sort = $scope.config.NEXT_FOLDER.SORT;
            $scope.taskFolders[SPRINT].displayOwner = $scope.config.NEXT_FOLDER.DISPLAY_PROPERTIES.OWNER;
            $scope.taskFolders[SPRINT].displayPercent = $scope.config.NEXT_FOLDER.DISPLAY_PROPERTIES.PERCENT;
            $scope.taskFolders[SPRINT].displayTotalWork = $scope.config.NEXT_FOLDER.DISPLAY_PROPERTIES.TOTALWORK;
            $scope.taskFolders[SPRINT].displayStartDate = $scope.config.NEXT_FOLDER.DISPLAY_PROPERTIES.STARTDATE;
            $scope.taskFolders[SPRINT].displayDueDate = $scope.config.NEXT_FOLDER.DISPLAY_PROPERTIES.DUEDATE;
            $scope.taskFolders[SPRINT].filterOnStartDate = $scope.config.NEXT_FOLDER.FILTER_ON_START_DATE;
            $scope.taskFolders[SPRINT].displayInReport = $scope.config.NEXT_FOLDER.REPORT.DISPLAY;
            $scope.taskFolders[SPRINT].allowAdd = true;
            $scope.taskFolders[SPRINT].allowEdit = true;

            $scope.taskFolders[DOING].type = DOING;
            $scope.taskFolders[DOING].initialStatus = $scope.config.STATUS.IN_PROGRESS.VALUE;
            $scope.taskFolders[DOING].display = $scope.config.INPROGRESS_FOLDER.ACTIVE;
            $scope.taskFolders[DOING].name = $scope.config.INPROGRESS_FOLDER.NAME;
            $scope.taskFolders[DOING].title = $scope.config.INPROGRESS_FOLDER.TITLE;
            $scope.taskFolders[DOING].limit = $scope.config.INPROGRESS_FOLDER.LIMIT;
            $scope.taskFolders[DOING].sort = $scope.config.INPROGRESS_FOLDER.SORT;
            $scope.taskFolders[DOING].displayOwner = $scope.config.INPROGRESS_FOLDER.DISPLAY_PROPERTIES.OWNER;
            $scope.taskFolders[DOING].displayPercent = $scope.config.INPROGRESS_FOLDER.DISPLAY_PROPERTIES.PERCENT;
            $scope.taskFolders[DOING].displayTotalWork = $scope.config.INPROGRESS_FOLDER.DISPLAY_PROPERTIES.TOTALWORK;
            $scope.taskFolders[DOING].displayStartDate = $scope.config.INPROGRESS_FOLDER.DISPLAY_PROPERTIES.STARTDATE;
            $scope.taskFolders[DOING].displayDueDate = $scope.config.INPROGRESS_FOLDER.DISPLAY_PROPERTIES.DUEDATE;
            $scope.taskFolders[DOING].filterOnStartDate = $scope.config.INPROGRESS_FOLDER.FILTER_ON_START_DATE;
            $scope.taskFolders[DOING].displayInReport = $scope.config.INPROGRESS_FOLDER.REPORT.DISPLAY;
            $scope.taskFolders[DOING].allowAdd = false;
            $scope.taskFolders[DOING].allowEdit = true;

            $scope.taskFolders[WAITING].type = WAITING;
            $scope.taskFolders[WAITING].initialStatus = $scope.config.STATUS.WAITING.VALUE;
            $scope.taskFolders[WAITING].display = $scope.config.WAITING_FOLDER.ACTIVE;
            $scope.taskFolders[WAITING].name = $scope.config.WAITING_FOLDER.NAME;
            $scope.taskFolders[WAITING].title = $scope.config.WAITING_FOLDER.TITLE;
            $scope.taskFolders[WAITING].limit = $scope.config.WAITING_FOLDER.LIMIT;
            $scope.taskFolders[WAITING].sort = $scope.config.WAITING_FOLDER.SORT;
            $scope.taskFolders[WAITING].displayOwner = $scope.config.WAITING_FOLDER.DISPLAY_PROPERTIES.OWNER;
            $scope.taskFolders[WAITING].displayPercent = $scope.config.WAITING_FOLDER.DISPLAY_PROPERTIES.PERCENT;
            $scope.taskFolders[WAITING].displayTotalWork = $scope.config.WAITING_FOLDER.DISPLAY_PROPERTIES.TOTALWORK;
            $scope.taskFolders[WAITING].displayStartDate = $scope.config.WAITING_FOLDER.DISPLAY_PROPERTIES.STARTDATE;
            $scope.taskFolders[WAITING].displayDueDate = $scope.config.WAITING_FOLDER.DISPLAY_PROPERTIES.DUEDATE;
            $scope.taskFolders[WAITING].filterOnStartDate = $scope.config.WAITING_FOLDER.FILTER_ON_START_DATE;
            $scope.taskFolders[WAITING].displayInReport = $scope.config.WAITING_FOLDER.REPORT.DISPLAY;
            $scope.taskFolders[WAITING].allowAdd = false;
            $scope.taskFolders[WAITING].allowEdit = true;

            $scope.taskFolders[DONE].type = DONE;
            $scope.taskFolders[DONE].initialStatus = $scope.config.STATUS.COMPLETED.VALUE;
            $scope.taskFolders[DONE].display = $scope.config.COMPLETED_FOLDER.ACTIVE;
            $scope.taskFolders[DONE].name = $scope.config.COMPLETED_FOLDER.NAME;
            $scope.taskFolders[DONE].title = $scope.config.COMPLETED_FOLDER.TITLE;
            $scope.taskFolders[DONE].limit = $scope.config.COMPLETED_FOLDER.LIMIT;
            $scope.taskFolders[DONE].sort = $scope.config.COMPLETED_FOLDER.SORT;
            $scope.taskFolders[DONE].displayOwner = $scope.config.COMPLETED_FOLDER.DISPLAY_PROPERTIES.OWNER;
            $scope.taskFolders[DONE].displayPercent = $scope.config.COMPLETED_FOLDER.DISPLAY_PROPERTIES.PERCENT;
            $scope.taskFolders[DONE].displayTotalWork = $scope.config.COMPLETED_FOLDER.DISPLAY_PROPERTIES.TOTALWORK;
            $scope.taskFolders[DONE].displayStartDate = $scope.config.COMPLETED_FOLDER.DISPLAY_PROPERTIES.STARTDATE;
            $scope.taskFolders[DONE].displayDueDate = $scope.config.COMPLETED_FOLDER.DISPLAY_PROPERTIES.DUEDATE;
            $scope.taskFolders[DONE].filterOnStartDate = $scope.config.COMPLETED_FOLDER.FILTER_ON_START_DATE;
            $scope.taskFolders[DONE].displayInReport = $scope.config.COMPLETED_FOLDER.REPORT.DISPLAY;
            $scope.taskFolders[DONE].allowAdd = false;
            $scope.taskFolders[DONE].allowEdit = false;
        } catch (error) {
            writeLog('applyConfig: ' + error)
        }
    };

    var DEFAULT_CONFIG = function() {
        return {
            "SOMEDAY_FOLDER": {
                "TYPE": SOMEDAY,
                "ACTIVE": false,
                "NAME": "Someday",
                "TITLE": "SOMEDAY/MAYBE",
                "LIMIT": 0,
                "SORT": "-priority",
                "DISPLAY_PROPERTIES": {
                    "OWNER": false,
                    "PERCENT": false,
                    "TOTALWORK": false,
                    "STARTDATE": false,
                    "DUEDATE": false
                },
                "FILTER_ON_START_DATE": undefined,
                "REPORT": {
                    "DISPLAY": false
                }
            },
            "BACKLOG_FOLDER": {
                "TYPE": BACKLOG,
                "ACTIVE": true,
                "NAME": "",
                "TITLE": "BACKLOG",
                "LIMIT": 0,
                "SORT": "duedate,-priority",
                "DISPLAY_PROPERTIES": {
                    "OWNER": false,
                    "PERCENT": false,
                    "TOTALWORK": false,
                    "STARTDATE": false,
                    "DUEDATE": true
                },
                "FILTER_ON_START_DATE": true,
                "REPORT": {
                    "DISPLAY": true
                }
            },
            "NEXT_FOLDER": {
                "TYPE": "SPRINT",
                "ACTIVE": true,
                "NAME": "Kanban",
                "TITLE": "NEXT",
                "LIMIT": 20,
                "SORT": "duedate,-priority",
                "DISPLAY_PROPERTIES": {
                    "OWNER": false,
                    "PERCENT": false,
                    "TOTALWORK": false,
                    "STARTDATE": false,
                    "DUEDATE": true
                },
                "FILTER_ON_START_DATE": undefined,
                "REPORT": {
                    "DISPLAY": true
                }
            },
            "INPROGRESS_FOLDER": {
                "TYPE": "DOING",
                "ACTIVE": true,
                "NAME": "Kanban",
                "TITLE": "IN PROGRESS",
                "LIMIT": 5,
                "SORT": "-priority",
                "DISPLAY_PROPERTIES": {
                    "OWNER": false,
                    "PERCENT": false,
                    "TOTALWORK": false,
                    "STARTDATE": false,
                    "DUEDATE": true
                },
                "FILTER_ON_START_DATE": undefined,
                "REPORT": {
                    "DISPLAY": true
                }
            },
            "WAITING_FOLDER": {
                "TYPE": "WAITING",
                "ACTIVE": true,
                "NAME": "Kanban",
                "TITLE": "WAITING",
                "LIMIT": 0,
                "SORT": "-priority",
                "DISPLAY_PROPERTIES": {
                    "OWNER": false,
                    "PERCENT": false,
                    "TOTALWORK": false,
                    "STARTDATE": false,
                    "DUEDATE": true
                },
                "FILTER_ON_START_DATE": undefined,
                "REPORT": {
                    "DISPLAY": true
                }
            },
            "COMPLETED_FOLDER": {
                "TYPE": "DONE",
                "ACTIVE": true,
                "NAME": "Kanban",
                "TITLE": "COMPLETED",
                "LIMIT": 0,
                "SORT": "-completeddate,-priority,subject",
                "DISPLAY_PROPERTIES": {
                    "OWNER": false,
                    "PERCENT": false,
                    "TOTALWORK": false,
                    "STARTDATE": false,
                    "DUEDATE": false
                },
                "FILTER_ON_START_DATE": undefined,
                "REPORT": {
                    "DISPLAY": true
                },
            },
            "ARCHIVE_FOLDER": {
                "NAME": "Completed"
            },
            "TASKNOTE_MAXLEN": 100,
            "DATE_FORMAT": "dd-MMM",
            "USE_CATEGORY_COLORS": true,
            "USE_CATEGORY_COLOR_FOOTERS": false,
            "DARK_MODE": false,
            "SAVE_STATE": true,
            "STATUS": {
                "NOT_STARTED": {
                    "VALUE": 0,
                    "TEXT": "Not Started"
                },
                "IN_PROGRESS": {
                    "VALUE": 1,
                    "TEXT": "In Progress"
                },
                "WAITING": {
                    "VALUE": 3,
                    "TEXT": "Waiting For Someone Else"
                },
                "COMPLETED": {
                    "VALUE": 2,
                    "TEXT": "Completed"
                }
            },
            "COMPLETED": {
                "AFTER_X_DAYS": 7,
                "ACTION": "ARCHIVE"
            },
            "AUTO_UPDATE": true,
            "AUTO_START_TASKS": true,
            "AUTO_START_DUE_TASKS": false,
            "LOG_ERRORS": false,
            "MULTI_MAILBOX": false,
            "ACTIVE_MAILBOXES": [],
            "NEW_VERSION_NOTIFICATION": true,
            "AUTO_REFRESH": true,
            "AUTO_REFRESH_MINUTES": 5
        }
    }

    var readState = function () {
        if (hasReadState){
            return;
        }
        try {
            var state = { 
                "private": "0", 
                "search": "", 
                "category": "<All Categories>", 
                "mailbox":""
            }; // default state

            if ($scope.config.SAVE_STATE) {
                var stateRaw = getJournalItem(STATE_ID);
                if (stateRaw !== null) {
                    state = JSON.parse(stateRaw);
                }
                else {
                    saveJournalItem(STATE_ID, JSON.stringify(state, null, 2));
                }
            }

            $scope.prevState = state;

            // check state.mailbox; if it is not found in the *active* mailboxes array
            // then take the default mailbox
            var isChanged = false;
            if (!$scope.contains($scope.config.ACTIVE_MAILBOXES, state.mailbox)) {
                try {
                    state.mailbox = $scope.mailboxes[0];
                    isChanged = true;
                }
                catch(error) {
                    debug_alert('set state.mailbox error: '+error)
                }
            }

            $scope.filter =
                {
                    private: state.private,
                    search: state.search,
                    category: state.category,
                    mailbox: state.mailbox
                };

            if (isChanged) {
                state.mailbox = ''; // sneaky, but otherwise nothing will be saved
                saveState();
            }

        } catch (error) {
            writeLog('readState: ' + error)
        }
        hasReadState = true;
    }

    $scope.contains = function (a, obj) {
        for (var i = 0; i < a.length; i++) {
            if (a[i] === obj) {
                return true;
            }
        }
        return false;
    }
    
    $scope.whatsnew = function () {
        return "https://janware.nl/gitlab/whatsnew.html"
    }

    var saveState = function () {
        try {
            if ($scope.config.SAVE_STATE) {
                var currState = { 
                    "private": $scope.filter.private, 
                    "search": $scope.filter.search, 
                    "category": $scope.filter.category, 
                    "mailbox": $scope.filter.mailbox
                };
                if (DeepDiff.diff($scope.prevState, currState)) {
                    saveJournalItem(STATE_ID, JSON.stringify(currState, null, 2));
                    $scope.prevState = currState;
                }
            }
        } catch (error) {
            writeLog('saveState: ' + error)
        }
    }

    var readConfig = function () {
        try {
            if (hasReadConfig) {
                return;
            }
            $scope.previousConfig = null;
            $scope.configRaw = getJournalItem(CONFIG_ID);
            if ($scope.configRaw !== null) {
                try {
                    $scope.config = JSON.parse(JSON.minify($scope.configRaw));
                }
                catch (e) {
                    alert("I am afraid there is something wrong with the json structure of your configuration data. Please correct it.");
                    writeLog('readConfig JSON parse error: ' + e)
                    $scope.switchToConfigMode();
                    return;
                }
                updateConfig();
                migrateConfig();
                $scope.includeLog = $scope.config.LOG_ERRORS;
            }
            else {
                $scope.config = DEFAULT_CONFIG();
                saveConfig();
            }
        } catch (error) {
            writeLog('readConfig: ' + error)
        }
        hasReadConfig = true;
    }

    var saveConfig = function () {
        try {
            saveJournalItem(CONFIG_ID, JSON.stringify($scope.config, null, 2));
            $scope.includeLog = $scope.config.LOG_ERRORS;
        } catch (error) {
            writeLog('saveConfig: ' + error)
        }
    }

    var updateConfig = function () {
        try {
            // Check for added or removed key entries in the config
            var delta = DeepDiff.diff($scope.config, DEFAULT_CONFIG());
            if (delta) {
                var isUpdated = false;
                $scope.previousConfig = $scope.config;
                delta.forEach(function (change) {
                    if (change.kind === 'N' || change.kind === 'D') {
                        DeepDiff.applyChange($scope.config, DEFAULT_CONFIG(), change);
                        isUpdated = true;
                    }
                });
                if (isUpdated) {
                    saveConfig();
                    // as long as we need configraw...
                    $scope.configRaw = getJournalItem(CONFIG_ID);
                }
            }
        } catch (error) {
            writeLog("updateConfig: " + error)
        }
    }

    var migrateConfig = function () {
        try {
            var isChanged = false;
            
            if ($scope.config.ACTIVE_MAILBOXES.length == 0) {
                $scope.config.ACTIVE_MAILBOXES.length = 1;
                $scope.config.ACTIVE_MAILBOXES[0] = $scope.mailboxes[0];
                saveConfig();
                // as long as we need configraw...
                $scope.configRaw = getJournalItem(CONFIG_ID);
            }

            var newArray = [];
            var i;
            for (i = 0; i < $scope.config.ACTIVE_MAILBOXES.length; i++) {
               var mailbox = $scope.config.ACTIVE_MAILBOXES[i];
               var fixed = fixMailboxName(mailbox);
               if (fixed !== mailbox) {
            		mailbox = fixed;
            		isChanged = true;
            	};
            	if (find($scope.mailboxes, mailbox)) {
            	   newArray.push(mailbox);
            	}
            	else {
            	   isChanged = true;
            	};
            };
            if (!find($scope.config.ACTIVE_MAILBOXES, $scope.mailboxes[0])) {
                newArray.push($scope.mailboxes[0]);
                isChanged = true;
            }
            if (isChanged) {
            	 $scope.config.ACTIVE_MAILBOXES = newArray;
                saveConfig();
                // as long as we need configraw...
                $scope.configRaw = getJournalItem(CONFIG_ID);
            }
        }
        catch (error) {
            writeLog('migrateConfig: ' + error)
        }
    }
    
    var find = function (arr, value) {
       var result = false;
        try {
       arr.forEach( function(elem) {
          if (elem === value) result = true;
       });
        }
        catch(error) {
        }
       return result;
    }

    var writeLog = function (message, noAlert) {
        if (noAlert != true) {
            alert('writeLog:'+ message)
        }
        try {
            var doLog = false;
            if ($scope.config == undefined) {
                doLog = true;
            }
            else {
                doLog = $scope.config.LOG_ERRORS;
            }
            if (doLog) {
                var now = new Date();
                var datetimeString = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate() + ' ' + now.getHours() + ':' + now.getMinutes();
                message = datetimeString + "  " + message;
                var logRaw = getJournalItem(LOG_ID);
                var log = [];
                if (logRaw !== null) {
                    log = JSON.parse(logRaw);
                }
                log.unshift(message);
                if (log.length > MAX_LOG_ENTRIES) {
                    log.pop();
                }
                saveJournalItem(LOG_ID, JSON.stringify(log, null, 2));
            }
        } catch (error) {
            alert('Unexpected writeLog error. Please make a screenprint and send it to janban@papasmurf.nl.\n\r ' + error)
        }
    }

    var setUrls = function () {
        // These variables are replaced in the build pipeline
        $scope.VERSION_URL = '#VERSION#';
        $scope.DOWNLOAD_URL = '#DOWNLOAD#';
        $scope.WHATSNEW_URL = '#WHATSNEW#';
        $scope.version = VERSION;
    }

    var debug_alert = function (msg) {
        if (debug_mode) {
            alert(msg)
        }
    };    

    var readVersion = function () {
        if (hasReadVersion) {
            return $scope.version_number;
        }
        try {
            $http.get($scope.VERSION_URL, { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } })
                .then(function (response) {
                    $scope.version_number = response.data;
                    $scope.version_number = $scope.version_number.replace(/\n|\r/g, "");
                    checkVersion();
				});
            hasReadVersion = true;
        } catch (error) {
            writeLog('readVersion: ' + error)
        }
    };

    var checkVersion = function () {
        try {
            if ($scope.version != $scope.version_number) {
                $scope.display_message = true;
            }
        } catch (error) {
            writeLog('checkVersion: ' + error)
        }
    };

    var getCategoryStyles = function (csvCategories) {

        const colorArray = [
            '#E7A1A2', '#F9BA89', '#F7DD8F', '#FCFA90', '#78D168', '#9FDCC9', '#C6D2B0', '#9DB7E8', '#B5A1E2',
            '#daaec2', '#dad9dc', '#6b7994', '#bfbfbf', '#6f6f6f', '#4f4f4f', '#c11a25', '#e2620d', '#c79930',
            '#b9b300', '#368f2b', '#329b7a', '#778b45', '#2858a5', '#5c3fa3', '#93446b'
        ];

        var getColor = function (category) {
            try {
                var c = outlookCategories.names.indexOf(category);
                var i = outlookCategories.colors[c];
                if (i == -1) {
                    return '#4f4f4f';
                }
                else {
                    return colorArray[i - 1];
                }
            } catch (error) {
                writeLog('getColor: ' + error);
            }
        }

        try {
            var i;
            var catStyles = [];
            var categories = csvCategories.split(/[;,]+/);
            catStyles.length = categories.length;
            for (i = 0; i < categories.length; i++) {
                categories[i] = categories[i].trim();
                if (categories[i].length > 0) {
                    if ($scope.config.USE_CATEGORY_COLORS) {
                        catStyles[i] = {
                            label: categories[i], style: { "background-color": getColor(categories[i]), color: getContrastYIQ(getColor(categories[i])) }
                        }
                    }
                    else {
                        catStyles[i] = {
                            label: categories[i], style: { color: "black" }
                        };
                    }
                }
            }
            return catStyles;
        } catch (error) {
            writeLog('getCategoryStyles: ' + error);
        }
    }

    function getContrastYIQ(hexcolor) {
        try {
            if (hexcolor == undefined) {
                return 'black';
            }
            var r = parseInt(hexcolor.substr(1, 2), 16);
            var g = parseInt(hexcolor.substr(3, 2), 16);
            var b = parseInt(hexcolor.substr(5, 2), 16);
            var yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            return (yiq >= 128) ? 'black' : 'white';
        } catch (error) {
            writeLog('getContrastYIQ: ' + message);
        }
    }
});
