'use strict';

const VERSION_URL = 'http://janware.nl/gitlab/version';

var JanBanOnline = function ($http) {

    this.getVersion = function (callback) {
        $http.get(VERSION_URL)
            .then(function(response) {
                callback("response.data");
                // callback(response.data);
            });
    };
    
};


