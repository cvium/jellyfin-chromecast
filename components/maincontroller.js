﻿define(['datetime', 'jellyfinactions', 'browserdeviceprofile', '//www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js'], function (datetime, jellyfinActions, deviceProfileBuilder) {
    window.castReceiverContext = cast.framework.CastReceiverContext.getInstance();
    window.mediaManager = window.castReceiverContext.getPlayerManager();
    window.mediaManager.addEventListener(cast.framework.events.category.CORE,
        event => {
          console.log("Core event: " + event.type);
          console.log(event);
        });
      
    const playbackConfig = new cast.framework.PlaybackConfig();
    // Set the player to start playback as soon as there are five seconds of
    // media content buffered. Default is 10.
    playbackConfig.autoResumeDuration = 5;

    // According to cast docs this should be disabled when not needed
    cast.framework.CastReceiverContext.getInstance().setLoggerLevel(cast.framework.LoggerLevel.DEBUG);

    var init = function () {

        resetPlaybackScope($scope);
    };

    init();

    var mgr = window.mediaManager;

    var broadcastToServer = new Date();

    function onMediaElementTimeUpdate(e) {
        if ($scope.isChangingStream) {
            return;
        }

        var now = new Date();

        var elapsed = now - broadcastToServer;

        if (elapsed > 5000) {
            // TODO use status as input
            jellyfinActions.reportPlaybackProgress($scope, getReportingParams($scope));
            broadcastToServer = now;
        }
        else if (elapsed > 1500) {
            // TODO use status as input
            jellyfinActions.reportPlaybackProgress($scope, getReportingParams($scope), false);
        }
    }

    function onMediaElementPause() {

        if ($scope.isChangingStream) {
            return;
        }

        reportEvent('playstatechange', true);
    }

    function onMediaElementPlaying() {

        if ($scope.isChangingStream) {
            return;
        }
        reportEvent('playstatechange', true);
    }

    function onMediaElementVolumeChange() {

        var volume = window.mediaElement.volume;
        window.VolumeInfo.Level = volume * 100;
        window.VolumeInfo.IsMuted = volume == 0;

        reportEvent('volumechange', true);
    }

    function enableTimeUpdateListener() {
        window.mediaManager.addEventListener(cast.framework.events.EventType.TIME_UPDATE, onMediaElementTimeUpdate);
        window.mediaManager.addEventListener(cast.framework.events.EventType.REQUEST_VOLUME_CHANGE, onMediaElementVolumeChange);
        window.mediaManager.addEventListener(cast.framework.events.EventType.PAUSE, onMediaElementPause);
        window.mediaManager.addEventListener(cast.framework.events.EventType.PLAYING, onMediaElementPlaying);
    }

    function disableTimeUpdateListener() {
        window.mediaManager.removeEventListener(cast.framework.events.EventType.TIME_UPDATE, onMediaElementTimeUpdate);
        window.mediaManager.removeEventListener(cast.framework.events.EventType.REQUEST_VOLUME_CHANGE, onMediaElementVolumeChange);
        window.mediaManager.removeEventListener(cast.framework.events.EventType.PAUSE, onMediaElementPause);
        window.mediaManager.removeEventListener(cast.framework.events.EventType.PLAYING, onMediaElementPlaying);
    }
    
    enableTimeUpdateListener();

    function isPlaying() {
        return window.mediaManager.getPlayerState() === cast.framework.messages.PlayerState.PLAYING;
    }

    window.addEventListener('beforeunload', function () {
        // Try to cleanup after ourselves before the page closes
        disableTimeUpdateListener();
        jellyfinActions.reportPlaybackStopped($scope, getReportingParams($scope));
    });

    mgr.defaultOnPlay = function (event) {

        jellyfinActions.play($scope, event);
        jellyfinActions.reportPlaybackProgress($scope, getReportingParams($scope));
    };
    mgr.addEventListener('PLAY', mgr.defaultOnPlay);

    mgr.defaultOnPause = function (event) {
        jellyfinActions.reportPlaybackProgress($scope, getReportingParams($scope));
    };
    mgr.addEventListener('PAUSE', mgr.defaultOnPause);

    mgr.defaultOnStop = function (event) {
        stop();
    };
    mgr.addEventListener('ABORT', mgr.defaultOnStop);

    mgr.addEventListener('ENDED', function () {

        // Ignore
        if ($scope.isChangingStream) {
            return;
        }

        jellyfinActions.reportPlaybackStopped($scope, getReportingParams($scope));
        init();

        if (!playNextItem()) {
            window.playlist = [];
            window.currentPlaylistIndex = -1;
            jellyfinActions.displayUserInfo($scope, $scope.serverAddress, $scope.accessToken, $scope.userId);
        }
    });

    function stop(nextMode) {

        $scope.playNextItem = nextMode ? true : false;
        jellyfinActions.stop($scope);

        var reportingParams = getReportingParams($scope);

        var promise;

        jellyfinActions.stopPingInterval();

        if (reportingParams.ItemId) {
            promise = jellyfinActions.reportPlaybackStopped($scope, reportingParams);
        }

        window.mediaManager.stop();
        promise = promise || Promise.resolve();

        return promise;
    }

    window.castReceiverContext.addEventListener(cast.framework.system.EventType.SYSTEM_VOLUME_CHANGED, function (event) {
        console.log("### Cast Receiver Manager - System Volume Changed : " + JSON.stringify(event.data));
        
        if ($scope.userId != null) {
            reportEvent('volumechange', true);
        }
    });

    // Set the active subtitle track once the player has loaded
    window.mediaManager.addEventListener(
        cast.framework.events.EventType.PLAYER_LOAD_COMPLETE, () => {
            setTextTrack(window.mediaManager.getMediaInformation().customData.subtitleStreamIndex);
        }
    );

    console.log('Application is ready, starting system');

    function cleanName(name) {

        return name.replace(/[^\w\s]/gi, '');
    }

    function processMessage(data) {

        if (!data.command || !data.serverAddress || !data.userId || !data.accessToken) {

            console.log('Invalid message sent from sender. Sending error response');

            broadcastToMessageBus({
                type: 'error',
                message: "Missing one or more required params - command,options,userId,accessToken,serverAddress"
            });
            return;
        }

        $scope.userId = data.userId;
        $scope.accessToken = data.accessToken;
        $scope.serverAddress = data.serverAddress;
        if (data.subtitleAppearance) {
            window.subtitleAppearance = data.subtitleAppearance;
        }

        data.options = data.options || {};
        var cleanReceiverName = cleanName(data.receiverName || '');
        window.deviceInfo.deviceName = cleanReceiverName || window.deviceInfo.deviceName;
        // deviceId just needs to be unique-ish
        window.deviceInfo.deviceId = cleanReceiverName ? btoa(cleanReceiverName) : window.deviceInfo.deviceId;

        if (data.maxBitrate) {
            window.MaxBitrate = data.maxBitrate;
        }

        // Items will have properties - Id, Name, Type, MediaType, IsFolder

        var reportEventType;
        var systemVolume = window.castReceiverContext.getSystemVolume();

        if (data.command == 'PlayLast' || data.command == 'PlayNext') {
            translateItems(data, data.options, data.options.items, data.command);
        }
        else if (data.command == 'Shuffle') {
            shuffle(data, data.options, data.options.items[0]);
        }
        else if (data.command == 'InstantMix') {
            instantMix(data, data.options, data.options.items[0]);
        }
        else if (data.command == 'DisplayContent' && !isPlaying()) {
            console.log('DisplayContent');
            jellyfinActions.displayItem($scope, data.serverAddress, data.accessToken, data.userId, data.options.ItemId);
        }
        else if (data.command == 'NextTrack' && window.playlist && window.currentPlaylistIndex < window.playlist.length - 1) {
            playNextItem({}, true);
        }
        else if (data.command == 'PreviousTrack' && window.playlist && window.currentPlaylistIndex > 0) {
            playPreviousItem({});
        }
        else if (data.command == 'SetAudioStreamIndex') {
            setAudioStreamIndex($scope, data.options.index);
        }
        else if (data.command == 'SetSubtitleStreamIndex') {
            setSubtitleStreamIndex($scope, data.options.index, data.serverAddress);
        }
        else if (data.command == 'VolumeUp') {
            window.castReceiverContext.setSystemVolumeLevel(Math.min(1, systemVolume.level + 0.2));
        }
        else if (data.command == 'VolumeDown') {
            window.castReceiverContext.setSystemVolumeLevel(Math.max(0, systemVolume.level - 0.2));
        }
        else if (data.command == 'ToggleMute') {
            window.castReceiverContext.setSystemVolumeMuted(!systemVolume.muted);
        }
        else if (data.command == 'Identify' && !isPlaying()) {
            jellyfinActions.displayUserInfo($scope, data.serverAddress, data.accessToken, data.userId);
        }
        else if (data.command == 'SetVolume') {
            // Scale 0-100
            window.castReceiverContext.setSystemVolumeLevel(data.options.volume / 100);
        }
        else if (data.command == 'Seek') {
            seek(data.options.position * 10000000);
        }
        else if (data.command == 'Mute') {
            window.castReceiverContext.setSystemVolumeMuted(true);
         }
        else if (data.command == 'Unmute') {
            window.castReceiverContext.setSystemVolumeMuted(false);
        }
        else if (data.command == 'Stop') {
            stop();
        }
        else if (data.command == 'PlayPause') {

            if (window.mediaManager.getPlayerState() === cast.framework.messages.PlayerState.PAUSED) {
                window.mediaManager.play();
            } else {
                window.mediaManager.pause();
            }
        }
        else if (data.command == 'Pause') {
            window.mediaManager.pause();
        }
        else if (data.command == 'SetRepeatMode') {
            window.repeatMode = data.options.RepeatMode;
            reportEventType = 'repeatmodechange';
        }
        else if (data.command == 'Unpause') {
            window.mediaManager.play();
        }
        else {
            translateItems(data, data.options, data.options.items, 'play');
        }

        if (reportEventType) {
            var report = function () {
                jellyfinActions.reportPlaybackProgress($scope, getReportingParams($scope));
            };
            jellyfinActions.reportPlaybackProgress($scope, getReportingParams($scope), true, reportEventType);
            setTimeout(report, 100);
            setTimeout(report, 500);
        }
    }

    function reportEvent(name, reportToServer) {
        jellyfinActions.reportPlaybackProgress($scope, getReportingParams($scope), reportToServer, name);
    }

    function setSubtitleStreamIndex($scope, index, serverAddress) {
        console.log('setSubtitleStreamIndex. index: ' + index);

        var currentSubtitleStream = $scope.mediaSource.MediaStreams.filter(function (m) {
            return m.Index == $scope.subtitleStreamIndex && m.Type == 'Subtitle';
        })[0];
        var currentDeliveryMethod = currentSubtitleStream ? currentSubtitleStream.DeliveryMethod : null;

        if (index == -1 || index == null) {
            // Need to change the stream to turn off the subs
            if (currentDeliveryMethod == 'Encode') {
                console.log('setSubtitleStreamIndex video url change required');
                var positionTicks = getCurrentPositionTicks($scope);
                changeStream(positionTicks, { SubtitleStreamIndex: -1 });
            } else {
                $scope.subtitleStreamIndex = -1;
                setTextTrack(null);
            }
            return;
        }

        var mediaStreams = $scope.PlaybackMediaSource.MediaStreams;

        var subtitleStream = getStreamByIndex(mediaStreams, 'Subtitle', index);

        if (!subtitleStream) {
            console.log('setSubtitleStreamIndex error condition - subtitle stream not found.');
            return;
        }

        console.log('setSubtitleStreamIndex DeliveryMethod:' + subtitleStream.DeliveryMethod);

        if (subtitleStream.DeliveryMethod == 'External' || currentDeliveryMethod == 'Encode') {

            var textStreamUrl = subtitleStream.IsExternalUrl ? subtitleStream.DeliveryUrl : getUrl(serverAddress, subtitleStream.DeliveryUrl);

            console.log('Subtitle url: ' + textStreamUrl);
            setTextTrack(index);
            $scope.subtitleStreamIndex = subtitleStream.Index;
            return;
        } else {
            console.log('setSubtitleStreamIndex video url change required');
            var positionTicks = getCurrentPositionTicks($scope);
            changeStream(positionTicks, { SubtitleStreamIndex: index });
        }
    }

    function setAudioStreamIndex($scope, index) {
        var positionTicks = getCurrentPositionTicks($scope);
        changeStream(positionTicks, { AudioStreamIndex: index });
    }

    function seek(ticks) {
        changeStream(ticks);
    }

    function changeStream(ticks, params) {
        if (ticks) {
            ticks = parseInt(ticks);
        }

        if (window.mediaManager.getMediaInformation().customData.canClientSeek && params == null) {

            window.mediaManager.seek(ticks / 10000000);
            jellyfinActions.reportPlaybackProgress($scope, getReportingParams($scope));
            return;
        }

        params = params || {};

        var playSessionId = $scope.playSessionId;
        var liveStreamId = $scope.liveStreamId;

        var item = $scope.item;
        var mediaType = item.MediaType;

        // TODO untangle this shitty callback mess
        getMaxBitrate(mediaType).then(function (maxBitrate) {
            var deviceProfile = getDeviceProfile(maxBitrate);

            var audioStreamIndex = params.AudioStreamIndex == null ? $scope.audioStreamIndex : params.AudioStreamIndex;
            var subtitleStreamIndex = params.SubtitleStreamIndex == null ? $scope.subtitleStreamIndex : params.SubtitleStreamIndex;

            jellyfinActions.getPlaybackInfo(item, maxBitrate, deviceProfile, ticks, $scope.mediaSourceId, audioStreamIndex, subtitleStreamIndex, liveStreamId).then(function (result) {
                if (validatePlaybackInfoResult(result)) {
                    var mediaSource = result.MediaSources[0];

                    var streamInfo = createStreamInfo(item, mediaSource, ticks);

                    if (!streamInfo.url) {
                        showPlaybackInfoErrorMessage('NoCompatibleStream');
                        return;
                    }
                    
                    var mediaInformation = createMediaInformation(playSessionId, item, streamInfo);
                    var loadRequest = new cast.framework.messages.LoadRequestData();
                    loadRequest.media = mediaInformation;
                    loadRequest.autoplay = true;

                    new Promise((resolve, reject) => {
                        // TODO something to do with HLS?
                        var requiresStoppingTranscoding = false;
                        if (requiresStoppingTranscoding) {
                            window.mediaManager.pause();
                            jellyfinActions.stopActiveEncodings(playSessionId).then(function () {
                                resolve();
                            });
                        } else {
                            resolve();
                        }
                    }).then(() => {
                        window.mediaManager.load(loadRequest);
                        window.mediaManager.play();
                        $scope.subtitleStreamIndex = subtitleStreamIndex;
                        $scope.audioStreamIndex = audioStreamIndex;
                    });
                }
            });
        });
    }

    // Create a message handler for the custome namespace channel
    // TODO save namespace somewhere global?
    window.castReceiverContext.addCustomMessageListener('urn:x-cast:com.connectsdk', function(evt) {
        console.log('Playlist message: ' + JSON.stringify(evt));

        var data = evt.data;

        data.options = data.options || {};
        data.options.senderId = evt.senderId;
        // TODO set it somewhere better perhaps
        window.senderId = evt.senderId;

        processMessage(data);
    });

    function tagItems(items, data) {
        // Attach server data to the items
        // Once day the items could be coming from multiple servers, each with their own security info
        for (var i = 0, length = items.length; i < length; i++) {
            items[i].userId = data.userId;
            items[i].accessToken = data.accessToken;
            items[i].serverAddress = data.serverAddress;
        }
    }

    function translateItems(data, options, items, method) {
        var callback = function (result) {
            options.items = result.Items;
            tagItems(options.items, data);

            if (method == 'PlayNext' || method == 'PlayLast') {
                queue(options.items, method);
            } else {
                playFromOptions(data.options);
            }
        };

        var smartTranslate = method != 'PlayNext' && method != 'PlayLast';
        translateRequestedItems(data.serverAddress, data.accessToken, data.userId, items, smartTranslate).then(callback);
    }

    function instantMix(data, options, item) {
        getInstantMixItems(data.serverAddress, data.accessToken, data.userId, item).then(function (result) {

            options.items = result.Items;
            tagItems(options.items, data);
            playFromOptions(data.options);
        });
    }

    function shuffle(data, options, item) {
        getShuffleItems(data.serverAddress, data.accessToken, data.userId, item).then(function (result) {
            options.items = result.Items;
            tagItems(options.items, data);
            playFromOptions(data.options);
        });
    }

    function queue(items) {
        for (var i = 0, length = items.length; i < length; i++) {
            window.playlist.push(items[i]);
        }
    }

    function playFromOptions(options) {
        var firstItem = options.items[0];

        if (options.startPositionTicks || firstItem.MediaType !== 'Video') {
            playFromOptionsInternal(options);
            return;
        }

        getIntros(firstItem.serverAddress, firstItem.accessToken, firstItem.userId, firstItem).then(function (intros) {

            tagItems(intros.Items, {
                userId: firstItem.userId,
                accessToken: firstItem.accessToken,
                serverAddress: firstItem.serverAddress
            });

            options.items = intros.Items.concat(options.items);
            playFromOptionsInternal(options);
        });
    }

    function playFromOptionsInternal(options) {

        var stopPlayer = window.playlist && window.playlist.length > 0;

        window.playlist = options.items;
        window.currentPlaylistIndex = -1;
        playNextItem(options, stopPlayer);
    }

    // Plays the next item in the list
    function playNextItem(options, stopPlayer) {

        var nextItemInfo = getNextPlaybackItemInfo();

        if (nextItemInfo) {
            window.currentPlaylistIndex = nextItemInfo.index;

            var item = nextItemInfo.item;

            playItem(item, options || {}, stopPlayer);
            return true;
        }

        return false;
    }

    function playPreviousItem(options) {

        var playlist = window.playlist;

        if (playlist && window.currentPlaylistIndex > 0) {
            window.currentPlaylistIndex--;

            var item = playlist[window.currentPlaylistIndex];

            playItem(item, options || {}, true);
            return true;
        }
        return false;
    }

    function playItem(item, options, stopPlayer) {

        var callback = function () {
            onStopPlayerBeforePlaybackDone(item, options);
        };

        if (stopPlayer) {

            stop("none").then(callback);
        }
        else {
            callback();
        }
    }

    function onStopPlayerBeforePlaybackDone(item, options) {

        var requestUrl = getUrl(item.serverAddress, 'Users/' + item.userId + '/Items/' + item.Id);

        return fetchhelper.ajax({

            url: requestUrl,
            headers: getSecurityHeaders(item.accessToken, item.userId),
            dataType: 'json',
            type: 'GET'

        }).then(function (data) {

            // Attach the custom properties we created like userId, serverAddress, itemId, etc
            extend(data, item);

            playItemInternal(data, options);

        }, broadcastConnectionErrorMessage);
    }

    function getDeviceProfile(maxBitrate) {

        var transcodingAudioChannels = document.createElement('video').canPlayType('audio/mp4; codecs="ac-3"').replace(/no/, '') ?
            6 :
            2;

        var profile = deviceProfileBuilder({
            supportsCustomSeeking: true,
            audioChannels: transcodingAudioChannels
        });

        profile.MaxStreamingBitrate = maxBitrate;
        profile.MaxStaticBitrate = maxBitrate;
        profile.MusicStreamingTranscodingBitrate = 192000;

        // This needs to be forced
        profile.DirectPlayProfiles.push({
            Container: "flac",
            Type: 'Audio'
        });

        profile.SubtitleProfiles = [];
        profile.SubtitleProfiles.push(
            {
                Format: 'vtt',
                Method: 'External'
            },
            {
                Format: 'vtt',
                Method: 'Hls'
            }
        );

        return profile;
    }

    function playItemInternal(item, options) {

        $scope.isChangingStream = false;
        setAppStatus('loading');

        getMaxBitrate(item.MediaType).then(function (maxBitrate) {

            var deviceProfile = getDeviceProfile(maxBitrate);

            jellyfinActions.getPlaybackInfo(item, maxBitrate, deviceProfile, options.startPositionTicks, options.mediaSourceId, options.audioStreamIndex, options.subtitleStreamIndex).then(function (result) {

                if (validatePlaybackInfoResult(result)) {

                    var mediaSource = getOptimalMediaSource(result.MediaSources);

                    if (mediaSource) {

                        if (mediaSource.RequiresOpening) {

                            jellyfinActions.getLiveStream(item, result.PlaySessionId, maxBitrate, deviceProfile, options.startPositionTicks, mediaSource, null, null).then(function (openLiveStreamResult) {

                                openLiveStreamResult.MediaSource.enableDirectPlay = supportsDirectPlay(openLiveStreamResult.MediaSource);
                                playMediaSource(result.PlaySessionId, item, openLiveStreamResult.MediaSource, options);
                            });

                        } else {
                            playMediaSource(result.PlaySessionId, item, mediaSource, options);
                        }
                    } else {
                        showPlaybackInfoErrorMessage('NoCompatibleStream');
                    }
                }

            }, broadcastConnectionErrorMessage);
        });
    }

    var lastBitrateDetect = 0;
    var detectedBitrate = 0;
    function getMaxBitrate(mediaType) {

        console.log('getMaxBitrate');

        return new Promise(function (resolve, reject) {

            if (window.MaxBitrate) {
                console.log('bitrate is set to ' + window.MaxBitrate);

                resolve(window.MaxBitrate);
                return;
            }

            if (detectedBitrate && (new Date().getTime() - lastBitrateDetect) < 600000) {
                console.log('returning previous detected bitrate of ' + detectedBitrate);
                resolve(detectedBitrate);
                return;
            }

            if (mediaType != 'Video') {
                // We don't need to bother with bitrate detection for music
                resolve(window.DefaultMaxBitrate);
                return;
            }

            console.log('detecting bitrate');

            jellyfinActions.detectBitrate($scope).then(function (bitrate) {

                console.log('Max bitrate auto detected to ' + bitrate);
                lastBitrateDetect = new Date().getTime();
                detectedBitrate = bitrate;

                resolve(detectedBitrate);

            }, function () {

                console.log('Error detecting bitrate, will return default value.');
                resolve(window.DefaultMaxBitrate);
            });
        });
    }

    function validatePlaybackInfoResult(result) {

        if (result.ErrorCode) {

            showPlaybackInfoErrorMessage(result.ErrorCode);
            return false;
        }

        return true;
    }

    function showPlaybackInfoErrorMessage(errorCode) {

        broadcastToMessageBus({
            type: 'playbackerror',
            message: errorCode
        });
    }

    function getOptimalMediaSource(versions) {

        var optimalVersion = versions.filter(function (v) {

            v.enableDirectPlay = supportsDirectPlay(v);

            return v.enableDirectPlay;

        })[0];

        if (!optimalVersion) {
            optimalVersion = versions.filter(function (v) {

                return v.SupportsDirectStream;

            })[0];
        }

        return optimalVersion || versions.filter(function (s) {
            return s.SupportsTranscoding;
        })[0];
    }

    function supportsDirectPlay(mediaSource) {

        if (mediaSource.SupportsDirectPlay && mediaSource.Protocol == 'Http' && !mediaSource.RequiredHttpHeaders.length) {

            // TODO: Need to verify the host is going to be reachable
            return true;
        }

        return false;
    }

    function setTextTrack(index) {
        try {
            var textTracksManager = window.mediaManager.getTextTracksManager();
            if (index == null) {
                textTracksManager.setActiveByIds(null);
                return;
            }

            var tracks = textTracksManager.getTracks();
            var subtitleTrack = tracks.find(function(track) {
                return track.trackId === index;
            });
            if (subtitleTrack) {
                textTracksManager.setActiveByIds([subtitleTrack.trackId]);
                var subtitleAppearance = window.subtitleAppearance;
                if (subtitleAppearance) {
                    var textTrackStyle = new cast.framework.messages.TextTrackStyle();
                    if (subtitleAppearance.dropShadow != null) {
                        // Empty string is DROP_SHADOW
                        textTrackStyle.edgeType = subtitleAppearance.dropShadow.toUpperCase() || cast.framework.messages.TextTrackEdgeType.DROP_SHADOW;
                        textTrackStyle.edgeColor = "#000000FF";
                    }

                    if (subtitleAppearance.font) {
                        textTrackStyle.fontFamily = subtitleAppearance.font;
                    }

                    if (subtitleAppearance.textColor) {
                        // Append the transparency, hardcoded to 100%
                        textTrackStyle.foregroundColor = subtitleAppearance.textColor + "FF";
                    }

                    if (subtitleAppearance.textBackground === "transparent") {
                        textTrackStyle.backgroundColor = "#00000000" // RGBA
                    }

                    switch(subtitleAppearance.textSize) {
                        case 'smaller':
                            textTrackStyle.fontScale = 0.6;
                            break;
                        case 'small':
                            textTrackStyle.fontScale = 0.8;
                            break;
                        case 'large':
                            textTrackStyle.fontScale = 1.15;
                            break;
                        case 'larger':
                            textTrackStyle.fontScale = 1.3;
                            break;
                        case 'extralarge':
                            textTrackStyle.fontScale = 1.45;
                            break;
                        default:
                            textTrackStyle.fontScale = 1.0;
                            break;
                    }
                    textTracksManager.setTextTrackStyle(textTrackStyle);
                }
            }
        } catch(e) {
            console.log("Setting subtitle track failed: " + e);
        }
    }

    function createMediaInformation(playSessionId, item, streamInfo) {
        var mediaInfo = new cast.framework.messages.MediaInformation();
        mediaInfo.contentId = streamInfo.url;
        mediaInfo.contentType = streamInfo.contentType;
        mediaInfo.customData = {
            startPositionTicks: streamInfo.startPositionTicks || 0,
            serverAddress: item.serverAddress,
            userId: item.userId,
            itemId: item.Id,
            mediaSourceId: streamInfo.mediaSource.Id,
            audioStreamIndex: streamInfo.audioStreamIndex,
            subtitleStreamIndex: streamInfo.subtitleStreamIndex,
            playMethod: streamInfo.isStatic ? 'DirectStream' : 'Transcode',
            runtimeTicks: streamInfo.mediaSource.RunTimeTicks,
            liveStreamId: streamInfo.mediaSource.LiveStreamId,
            accessToken: item.accessToken,
            canSeek: streamInfo.canSeek,
            canClientSeek: streamInfo.canClientSeek,
            playSessionId: playSessionId
        }

        mediaInfo.metadata = getMetadata(item, datetime);

        mediaInfo.streamType = cast.framework.messages.StreamType.BUFFERED;
        mediaInfo.tracks = streamInfo.tracks;

        if (streamInfo.mediaSource.RunTimeTicks) {
            mediaInfo.duration = Math.floor(streamInfo.mediaSource.RunTimeTicks / 10000000);
        }

        mediaInfo.customData.startPositionTicks = streamInfo.startPosition || 0;

        return mediaInfo;
    }

    function playMediaSource(playSessionId, item, mediaSource, options) {

        setAppStatus('loading');

        var streamInfo = createStreamInfo(item, mediaSource, options.startPositionTicks);

        var url = streamInfo.url;

        var mediaInfo = createMediaInformation(playSessionId, item, streamInfo);
        var loadRequestData = new cast.framework.messages.LoadRequestData();
        loadRequestData.media = mediaInfo;
        loadRequestData.autoplay = true;

        jellyfinActions.load($scope, mediaInfo.customData, item);
        window.mediaManager.load(loadRequestData);

        $scope.PlaybackMediaSource = mediaSource;

        console.log('setting src to ' + url);
        $scope.mediaSource = mediaSource;

        if (item.BackdropImageTags && item.BackdropImageTags.length) {
            backdropUrl = $scope.serverAddress + '/emby/Items/' + item.Id + '/Images/Backdrop/0?tag=' + item.BackdropImageTags[0];
        } else if (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length) {
            backdropUrl = $scope.serverAddress + '/emby/Items/' + item.ParentBackdropItemId + '/Images/Backdrop/0?tag=' + item.ParentBackdropImageTags[0];
        }
        
        if(backdropUrl) {
            window.mediaElement.style.setProperty('--background-image', 'url("' + backdropUrl + '")');
        } else {
            //Replace with a placeholder?
            window.mediaElement.style.removeProperty('--background-image');
        }

        jellyfinActions.reportPlaybackStart($scope, getReportingParams($scope));

        // We use false as we do not want to broadcast the new status yet
        // we will broadcast manually when the media has been loaded, this
        // is to be sure the duration has been updated in the media element
        window.mediaManager.setMediaInformation(mediaInfo, false);
    }

    window.castReceiverContext.start(playbackConfig);
});