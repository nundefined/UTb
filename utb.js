(function (global) {
  // TODO 시청한 비디오를 목록 만들 때 제거하는 기능
  
  var IN_PROGRESS = 'blink';
  var MAX_RESULTS_PER_REQUEST = 50;
  var ACTIVITY_TYPE = {
        BULLETIN: 'bulletin',
        CHANNEL_ITEM: 'channelItem',
        COMMENT: 'comment',
        FAVORITE: 'favorite',
        LIKE: 'like',
        PLAYLIST_ITEM: 'playlistItem',
        RECOMMENDATION: 'recommendation',
        SOCIAL: 'social',
        SUBSCRIPTION: 'subscription',
        UPLOAD: 'upload'
  };

  var NEXT_VIDEO_INTERVAL = 2000;

  var DEFAULT_FILTER = {
    MAX_TIME: 10 * 60, // sec
    BEFORE_DAYS: 3, // 2 days
    INCLUDE_RECOMMEND: false,
    EXCLUDED_CHANNELS: [
      'UCvc8kv-i5fvFTJBFAk6n1SA', // 생활코딩
      'UClMlpXq4tDryAioZisO7JJQ', // 굿샷김프로
      'UCsLdjJ-pztJ7xV1axh14p5Q', // Yonsei HCI Lab,
      'UCEBb1b_L6zDS3xTUrIALZOw', // MIT OpenCourseWare
    ]
  };

  var utb = {
    apiKey: keys.apiKey,
    clientId: keys.clientId,
    scopes: keys.scopes,

    activities: [],
    video_activities: {},

    activitiy_loaded: 0,
    video_loaded: 0,

    playList: [],

    totalPlayTime: 0,

    storage: null,
    storageKey: {
      maxTime: 'utb.maxTime',
      maxDay: 'utb.maxDay',
      includeRecommend: 'utb.incRecommd',
      excludeChannels: 'utb.excChannels'
    },

    init: function () {
      this.storage = localStorage;
      this.setDefaultFilters();
      this.setFilterHandlers();
    },

    filters: {},

    filterFunctions: {
      maxTime: function (videoInfo) {
        if (videoInfo.utbData.duration <= this.filters.maxTime) {
          return true;
        }
      },
      maxDay: function (videoInfo) {
        var baseDate = moment().subtract(this.filters.maxDay, 'days');
        var pubDate = moment(videoInfo.snippet.publishedAt);
        return baseDate.isBefore(pubDate);
      },
      recommend: function (videoInfo) {
        return !videoInfo.recommendation || this.filters.includeRecommend;
      },
      excludeChannels: function (videoInfo) {
        var index = _.indexOf(this.filters.excludeChannels, videoInfo.snippet.channelId);

        if (index < 0) {
          return true;
        }
      },
    },

    setFilterValue: function (key, value) {
      this.filters[key] = value;
      this.storage.setItem(this.storageKey[key], value);
    },

    setDefaultFilters: function () {
      var maxTime = this.storage.getItem(this.storageKey.maxTime);
      var maxDay = this.storage.getItem(this.storageKey.maxDay);
      var includeRecommend = this.storage.getItem(this.storageKey.includeRecommend);
      var excludeChannels = this.storage.getItem(this.storageKey.excludeChannels);

      if (!maxTime) {
        maxTime = DEFAULT_FILTER.MAX_TIME;
      }
      $('#maxTime').val(maxTime);
      this.setFilterValue('maxTime', maxTime);

      if (!maxDay) {
        maxDay = DEFAULT_FILTER.BEFORE_DAYS
      }
      $('#maxDay').val(maxDay);
      this.setFilterValue('maxDay', maxDay);

      if (!includeRecommend) {
        includeRecommend = DEFAULT_FILTER.INCLUDE_RECOMMEND;
      }
      $('#recommend').val(includeRecommend);
      this.setFilterValue('includeRecommend', includeRecommend === 'true' ? true : false);

      this.filters.excludeChannels = DEFAULT_FILTER.EXCLUDED_CHANNELS;
    },

    setFilterHandlers: function () {
      var self = this;
      $('._updateList').on('change', function (e) {
        var $target = $(e.currentTarget);
        var changedTarget = $target.attr('id');
        var value = $target.val();

        switch(changedTarget) {
        case 'maxTime':
          self.setFilterValue('maxTime', value);
          break;
        case 'maxDay':
          self.setFilterValue('maxDay', value);
          break;
        case 'recommend':
          self.setFilterValue('includeRecommend', value === 'true' ? true : false);
          break;
        }

        if (self.activitiy_loaded > 0) {
          self.updateList();
        }
      });
    },

    apiLoaded: function () {
      gapi.client.setApiKey(this.apiKey);
      setTimeout(_.bind(this.checkAuth, this), 1);
    },

    checkAuth: function (immediate) {
      if (immediate === undefined) {
        immediate = true
      }

      gapi.auth.authorize({
        client_id: this.clientId,
        scope: this.scopes,
        immediate: immediate
      }, _.bind(this.handleAuthResult, this));
    },

    handleAuthResult: function (authResult) {
      var $authorizeButton = $('#btnAuth');

      if (authResult && !authResult.error) {
        $authorizeButton.prop('disabled', true);
        this.makeUTbPlaylist();
      } else {
        $authorizeButton.prop('disabled', false);
        $authorizeButton.on('click', _.bind(this.handleAuthClick, this));
      }
    },

    handleAuthClick: function () {
      this.checkAuth(false);
      return false;
    },

    makeUTbPlaylist: function () {
      var self = this;

      $('#step1').addClass(IN_PROGRESS);

      this.getActivities()
          .then(_.bind(this.getVideoInfo, this))
          .then(_.bind(this.updateList, this))
          // .then(_.bind(this.makeResult, this))
          .then(_.bind(this.activateUpload, this))
          .then(function () {
            $('#step1').removeClass(IN_PROGRESS);
          });
    },

    getActivities: function (path, params) {
      var self = this;
      var newPath = path || '/activities';
      var newParams = params || {
        part: 'snippet,contentDetails',
        home: true
      };

      return this._request(newPath, newParams).then(function (res) {
        self.activitiy_loaded += res.result.items.length;
        self.activities = self.activities.concat(self._getVideoActivities(res.result.items));

        // pageInfo.totalResults가 제일 마지막 페이지에 이르기 전까지
        // 1이 더 많게 나오는 경우가 있음. 그러나 마지막에는 정상적으로 노출되어 정상 동작함.
        // 왜일까?
        if (self.activitiy_loaded < res.result.pageInfo.totalResults) {
          return self.getActivities(newPath, _.defaults({
            pageToken: res.result.nextPageToken
          }, newParams));
        }
      }, function (reason) {
        console.error('Error: ' + reason.result.error.message);
      });
    },

    _getVideoActivities: function (items) {
      var self = this;

      return _.filter(items, function (item) {
        var result = false;
        var videoId;

        switch (item.snippet.type) {
        case ACTIVITY_TYPE.RECOMMENDATION:
          videoId = item.contentDetails.recommendation.resourceId.videoId;
          self.video_activities[videoId] = item;
          self.video_activities[videoId].recommendation = true;
          result = true;
          break;
        case ACTIVITY_TYPE.UPLOAD:
          videoId = item.contentDetails.upload.videoId;
          self.video_activities[videoId] = item;
          self.video_activities[videoId].recommendation = false;
          result = true;
          break;
        }
        
        return result;
      });
    },

    getVideoInfo: function () {
      var self = this;
      var newPath = '/videos';
      var newParams = {
        part: 'contentDetails'
      };

      var targetVideos = this.activities.slice(this.video_loaded, this.video_loaded + MAX_RESULTS_PER_REQUEST);

      var ids = _.map(targetVideos, function (videoInfo) {
        switch (videoInfo.snippet.type) {
        case ACTIVITY_TYPE.UPLOAD:
          return videoInfo.contentDetails.upload.videoId;
          break;
        case ACTIVITY_TYPE.RECOMMENDATION:
          return videoInfo.contentDetails.recommendation.resourceId.videoId;
          break;  
        }
      });

      this.video_loaded += MAX_RESULTS_PER_REQUEST;
      
      newParams.id = ids.join(',');

      return this._request(newPath, newParams).then(function (res) {
        self._addVideoProperties(res.result.items);

        if (self.video_loaded < self.activities.length) {
          return self.getVideoInfo()
        }
      }, function (reason) {
        console.error('Error: ' + reason.result.error.message);
      });
    },

    _addVideoProperties: function (videoInfo) {
      var self = this;
      _.each(videoInfo, function (info) {
        var video = self.video_activities[info.id];
        video.utbData = {
          duration: self._getDurationInSec(info.contentDetails.duration),
          videoId: info.id
        }
      });
    },

    _getDurationInSec: function (duration) {
      var regexp = /PT((\d+)H)?((\d+)M)?((\d+)S)?/;
      var result = regexp.exec(duration);
      var time = 0;

      if (result[2]) {
        time += parseInt(result[2], 10) * 3600;
      }

      if (result[4]) {
        time += parseInt(result[4], 10) * 60;
      }

      if (result[6]) {
        time += parseInt(result[6], 10);
      }

      return time;
    },

    updateList: function () {
      return this.makePlayList().then(_.bind(this.makeResult, this));
    },

    makePlayList: function () {
      var self = this;
      var result = _.extend({}, self.video_activities);

      _.each(this.filterFunctions, function (filter) {
        if (!_.isFunction(filter)) {
          return;
        }

        result = _.filter(result, filter, self);
      });

      result = _.sortBy(result, function (item) {
        return -1 * moment(item.snippet.publishedAt).format('X');
      });

      this.playList = result;

      return Promise.resolve();
    },

    makeResult: function () {
      var self = this;
      var videoCount = _.size(this.playList);

      var template = Handlebars.compile($('#resultTemplate').html());
      var htmlResult = '';

      this.totalPlayTime = 0;
    
      _.each(this.playList, function (item) {
        self.totalPlayTime += item.utbData.duration;
      });

      htmlResult = template({
        items: this.playList
      });

      $('#result').html(htmlResult);

      $('._videoCount').text(videoCount);
      $('._playTime').text(this.totalPlayTime);

      $('.carousel-inner').find('.item').first().addClass('active');
      $('.carousel').carousel({
        interval: NEXT_VIDEO_INTERVAL
      });
      
    },

    activateUpload: function () {
      var self = this;
      $('#btnMakeList').on('click', function (e) {
        e.preventDefault();
        self.uploadPlayList();
      });
    },

    uploadPlayList: function () {
      $('#step2').addClass(IN_PROGRESS);

      this.makeYouTubePlayList().then(function () {
        $('#step2').removeClass(IN_PROGRESS);
        $('#step3').addClass(IN_PROGRESS);
        return Promise.resolve(arguments);
      })
      .then(_.bind(this.makePlayListItems, this))
      .then(function () {
        $('#step3').removeClass(IN_PROGRESS);
        $('#step4').addClass(IN_PROGRESS);
      })
    },

    makeYouTubePlayList: function () {
      var self = this;
      var path = '/playlists';
      var params = {
        part: 'snippet,status',
        resource: {
          snippet: {
            title: this.getTitle(),
            description: this.getDescription()
          },
          status: {
            privacyStatus: 'private'
          }
        }
      };

      return gapi.client.youtube.playlists.insert(params);
    },

    getTitle: function () {
      return moment().format('M월 D일의 플레이리스트');
    },

    getDescription: function () {
      return this.getTitle() + '를 즐기세요.';
    },

    makePlayListItems: function (res) {
      var promise = Promise.resolve();

      var listInfo = res[0].result;
      var params = {
        part: 'snippet',
        snippet: {
          playlistId: listInfo.id
        }
      };

      _.each(this.playList, function (item) {
        // Promise.all을 사용하여 동시에 여러 요청을 보낼 경우 
        // api 이슈인지 마지막 값으로 캐시되는 문제가 있어 순차적으로 요청을 보낸다.
        promise = promise.then(function () {
          var newParams = params;
          newParams.snippet.resourceId = {
            videoId: item.utbData.videoId,
            kind: 'youtube#video'
          };

          return gapi.client.youtube.playlistItems.insert(newParams);
        });
      });

      return promise;
    },

    _request: function (path, params) {
      var self = this;

      params = _.extend({
        maxResults: MAX_RESULTS_PER_REQUEST
      }, params);

      return gapi.client.request({
        'path': '/youtube/v3' + path,
        'params': params
      });
    }
  };

  utb.init();

  global.utb = utb;
})(window);

function initialize() {
  gapi.client.load('youtube', 'v3', start)
}

function start() {
  utb.apiLoaded();
}