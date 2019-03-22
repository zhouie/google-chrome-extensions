(function() {
    'use strict';

    function youtube_search_while_watching_video() {
        var script = {
            loaded: false,
            ytplayer: null,
            modern: false,
            search_bar: null,
            search_timeout: null,
            search_suggestions: [],
            suggestion_observer: null,
            debug: false
        };

        document.addEventListener("DOMContentLoaded", initScript);

        // reload script on page change using youtube spf events (http://youtube.github.io/js/documentation/events/)
        window.addEventListener("spfdone", function(e) {
            if (script.debug) { console.log("# page updated (normal) #"); }
            startScript(2);
        });

        // reload script on page change using youtube polymer fire events
        window.addEventListener("yt-page-data-updated", function(event) {
            if (script.debug) { console.log("# page updated (material) #"); }
            startScript(2);
        });

        function initScript() {
            if (script.debug) { console.log("Youtube search while watching video initializing"); }

            if (window.Polymer === undefined) {
                if (script.debug) { console.log("### Normal youtube loaded ###"); }
                script.modern = false;
            } else {
                if (script.debug) { console.log("### Material youtube loaded ###"); }
                script.modern = true;
            }

            initSearch();
            initSuggestionObserver();
            injectCSS();

            script.loaded = true;

            startScript(5);
        }

        function startScript(retry) {
            if (script.loaded && isPlayerAvailable()) {
                if (script.debug) { console.log("videoplayer is available"); }

                script.ytplayer = getVideoPlayer();
                if (script.debug) { console.log("ytplayer: ", script.ytplayer); }

                if (script.ytplayer) {
                    try {
                        if (script.debug) { console.log("initializing search"); }
                        loadSearch();
                    } catch (error) {
                        console.log("failed to initialize search: ", (script.debug) ? error : error.message);
                    }
                } else if (retry > 0) { // fix conflict with Youtube+ script
                    setTimeout(function() {
                        startScript(--this.retry);
                    }.bind({retry:retry}), 1000);
                }
            } else {
                if (script.debug) { console.log("videoplayer is unavailable"); }
            }
        }

        // *** OBSERVERS *** //

        function initSuggestionObserver() {
            script.suggestion_observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    forEach(mutation.addedNodes, function(addedNode) {
                        if (!addedNode.classList.contains('generated') && addedNode.tagName !== "YTD-COMPACT-AUTOPLAY-RENDERER") {
                            addedNode.classList.add('suggestion-tag');
                        }
                    });
                });
            });
        }

        // *** VIDEOPLAYER *** //

        // video object (normal youtube only)
        function ytVideo(html, anchor, id, title, author, time, stats, thumb) {
            this.html = html;
            this.buttonAnchor = anchor;
            this.id = id;
            this.title = title;
            this.author = author;
            this.time = time;
            this.stats = stats;
            this.iurlhq = thumb;
            this.iurlmq = thumb;
        }

        function getVideoPlayer() {
            return document.getElementById('movie_player');
        }

        function isPlayerAvailable() { // available on video pages without playlist or live chat
            return (/https:\/\/www\.youtube\.com\/watch\?v=.*/.test(document.location.href));
        }

        function isPlaylist() {
            return script.ytplayer.getPlaylist() !== null;
        }

        function isLivePlayer() {
            return script.ytplayer.getVideoData().isLive;
        }

        // *** SEARCH *** //

        function initSearch() {
            // callback function for search suggestion results
            window.suggestions_callback = suggestions_callback;
        }

        function loadSearch() {
            if (script.modern) {
                showSuggestions(true);

                // prevent double searchbar
                var playlistOrLiveSearchBar = document.querySelector('#suggestions-search.playlist-or-live');
                if (playlistOrLiveSearchBar) { playlistOrLiveSearchBar.remove(); }
            }

            if (!document.getElementById('suggestions-search')) {
                createSearchBar();
                tagSuggestions();
            }

            cleanupSuggestionRequests();
        }

        function createSearchBar() {
            var anchor, html;

            if (script.modern) {
                anchor = document.querySelector('ytd-compact-autoplay-renderer > #contents');
                if (anchor) {
                    html = "<input id=\"suggestions-search\" type=\"search\" placeholder=\"Search\">";
                    anchor.insertAdjacentHTML("afterend", html);
                } else { // playlist or live video?
                    anchor = document.querySelector('#related > ytd-watch-next-secondary-results-renderer');
                    if (anchor) {
                        html = "<input id=\"suggestions-search\" class=\"playlist-or-live\" type=\"search\" placeholder=\"Search\">";
                        anchor.insertAdjacentHTML("beforebegin", html);
                    }
                }
            } else {
                anchor = document.querySelector('#watch7-sidebar-modules > div:nth-child(2)');
                if (anchor) {
                    html = "<input id=\"suggestions-search\" class=\"search-term yt-uix-form-input-bidi\" type=\"search\" placeholder=\"Search\">";
                    anchor.insertAdjacentHTML("afterbegin", html);
                } else { // playlist or live video?
                    anchor = document.querySelector('#watch7-sidebar-modules');
                    if (anchor) {
                        html = "<input id=\"suggestions-search\" class=\"search-term yt-uix-form-input-bidi playlist-or-live\" type=\"search\" placeholder=\"Search\">";
                        anchor.insertAdjacentHTML("afterbegin", html);
                    }
                }
            }

            var searchBar = document.getElementById('suggestions-search');
            if (searchBar) {
                script.search_bar = searchBar;

                new autoComplete({
                    selector: '#suggestions-search',
                    minChars: 1,
                    delay: 250,
                    source: function(term, suggest) {
                        suggest(script.search_suggestions);
                    },
                    onSelect: function(event, term, item) {
                        prepareNewSearchRequest(term);
                    }
                });

                script.search_bar.addEventListener("keyup", function(event) {
                    if (this.value === "") {
                        showSuggestions(true);
                    } else {
                        searchSuggestions(this.value);
                    }
                });

                // seperate keydown listener because the search listener blocks keyup..?
                script.search_bar.addEventListener("keydown", function(event) {
                    const ENTER = 13;
                    if (this.value.trim() !== "" && (event.key == "Enter" || event.keyCode === ENTER)) {
                        prepareNewSearchRequest(this.value.trim());
                    }
                });

                script.search_bar.addEventListener("search", function(event) {
                    if(this.value === "") {
                        script.search_bar.blur(); // close search suggestions dropdown
                        script.search_suggestions = []; // clearing the search suggestions
                        showSuggestions(true);
                    }
                });

                script.search_bar.addEventListener("focus", function(event) {
                    this.select();
                });
            }
        }

        // add class to current suggestions, so we can toggle hide/show
        function tagSuggestions() {
            if (script.suggestion_observer) {
                script.suggestion_observer.disconnect();

                var observables = document.querySelectorAll('ytd-watch-next-secondary-results-renderer > #items, #watch-related, #watch-more-related');
                forEach(observables, function(observable) {
                    script.suggestion_observer.observe(observable, { childList: true });
                });
            }

            var suggestions = document.querySelectorAll('#watch-related > li.video-list-item, ytd-compact-video-renderer.ytd-watch-next-secondary-results-renderer, ytd-compact-radio-renderer.ytd-watch-next-secondary-results-renderer');
            forEach(suggestions, function(suggestion) {
                suggestion.classList.add('suggestion-tag');
            });
        }

        // toggle hide/show suggestions depending on $show and remove previously searched videos if any
        function showSuggestions(show) {
            var video_list_items = document.querySelectorAll('#watch-related > li.video-list-item, #watch-more-related > li.video-list-item, ytd-compact-video-renderer.ytd-watch-next-secondary-results-renderer, ytd-compact-radio-renderer.ytd-watch-next-secondary-results-renderer');

            forEachReverse(video_list_items, function(video) {
                if (video.classList.contains('suggestion-tag')) {
                    video.style.display = (show) ? "" : "none";
                } else {
                    video.remove();
                }
            });

            if (!script.modern) {
                var watch_related = document.getElementById('watch-related');

                var currNavigation = watch_related.parentNode.querySelector('.search-pager');
                if (currNavigation) { currNavigation.remove(); } // remove navigation

                var seperation_line = watch_related.parentNode.querySelector('.watch-sidebar-separation-line');
                if (seperation_line) { seperation_line.remove(); } // remove seperation line
            }

            var showMore = document.getElementById('watch-more-related-button') || document.querySelector('#continuations.ytd-watch-next-secondary-results-renderer');
            if (showMore) { showMore.style.display = (show) ? "" : "none"; } // toggle hide/show the "More Suggestions" link
        }

        // callback from search suggestions attached to window
        function suggestions_callback(data) {
            var raw = data[1]; // extract relevant data from json
            var suggestions = raw.map(function(array) {
                return array[0]; // change 2D array to 1D array with only suggestions
            });
            if (script.debug) { console.log(suggestions); }
            script.search_suggestions = suggestions;
        }

        function searchSuggestions(value) {
            if (script.search_timeout !== null) { clearTimeout(script.search_timeout); }

            // youtube search parameters
            const GeoLocation = window.yt.config_.INNERTUBE_CONTEXT_GL;
            const HostLanguage = window.yt.config_.INNERTUBE_CONTEXT_HL;

            // only allow 1 suggestion request every 100 milliseconds
            script.search_timeout = setTimeout(function() {
                if (script.debug) { console.log("suggestion request send", this.searchValue); }
                var scriptElement = document.createElement("script");
                scriptElement.type = "text/javascript";
                scriptElement.className = "suggestion-request";
                scriptElement.src = "https://clients1.google.com/complete/search?client=youtube&hl=" + HostLanguage + "&gl=" + GeoLocation + "&gs_ri=youtube&ds=yt&q=" + encodeURIComponent(this.searchValue) + "&callback=suggestions_callback";
                (document.body || document.head || document.documentElement).appendChild(scriptElement);
            }.bind({searchValue:value}), 100);
        }

        function cleanupSuggestionRequests() {
            var requests = document.getElementsByClassName('suggestion-request');
            forEachReverse(requests, function(request) {
                request.remove();
            });
        }

        // send new search request (with the search bar)
        function prepareNewSearchRequest(value) {
            if (script.debug) { console.log("searching for " + value); }

            script.search_bar.blur(); // close search suggestions dropdown
            script.search_suggestions = []; // clearing the search suggestions

            sendSearchRequest("https://www.youtube.com/results?" + (script.modern ? "search_query=" : "disable_polymer=1&q=") + encodeURIComponent(value));
        }

        // given the url, retrieve the search results
        function sendSearchRequest(url) {
            var xmlHttp = new XMLHttpRequest();
            xmlHttp.onreadystatechange = function() {
                if (xmlHttp.readyState == 4 && xmlHttp.status == 200) {
                    if (script.modern) {
                        processSearchModern(xmlHttp.responseText);
                    } else {
                        var container = document.implementation.createHTMLDocument().documentElement;
                        container.innerHTML = xmlHttp.responseText;
                        processSearch(container);
                    }
                }
            };
            xmlHttp.open("GET", url, true);
            xmlHttp.send(null);
        }

        // process search request (normal youtube)
        function processSearch(container) {
            var watch_related = document.getElementById('watch-related');

            // hide current suggestions and remove searched videos if any
            showSuggestions(false);

            // insert searched videos
            var video_items = container.querySelectorAll('.item-section .yt-lockup-video');
            forEach(video_items, function(video_item) {
                if (video_item.querySelector('.yt-badge-live') === null) {
                    try {
                        var videoId = video_item.dataset.contextItemId;
                        var videoTitle = video_item.querySelector('.yt-lockup-title > a').title;
                        var videoStats = video_item.querySelector('.yt-lockup-meta').innerHTML;
                        var videoTime = video_item.querySelector('.video-time') ? video_item.querySelector('.video-time').textContent : "0";
                        var author = video_item.querySelector('.yt-lockup-byline') ? video_item.querySelector('.yt-lockup-byline').textContent : "";
                        var videoThumb = video_item.querySelector('div.yt-lockup-thumbnail img').dataset.thumb || video_item.querySelector('div.yt-lockup-thumbnail img').src;

                        var videoObject = new ytVideo(null, null, videoId, videoTitle, author, videoTime, videoStats, videoThumb);
                        if (script.debug) { console.log(videoObject); }

                        watch_related.insertAdjacentHTML("beforeend", videoQueueHTML(videoObject).html);
                    } catch (error) {
                        console.error("failed to process video " + error.message, video_item);
                    }
                }
            });

            // insert navigation buttons
            var navigation = container.querySelector('.search-pager');
            var navigation_buttons = navigation.getElementsByTagName('a');
            forEach(navigation_buttons, function(button) {
                button.addEventListener("click", function handler(e) {
                    e.preventDefault();
                    script.search_bar.scrollIntoView();
                    window.scrollBy(0, -1 * document.getElementById('yt-masthead-container').clientHeight);
                    sendSearchRequest(this.href);
                });
            });

            watch_related.parentNode.appendChild(navigation); // append new navigation
            watch_related.insertAdjacentHTML("afterend", "<hr class=\"watch-sidebar-separation-line\">"); // insert separation line between videos and navigation
        }

        // process search request (material youtube)
        function processSearchModern(responseText) {
            // extract json with search results from response
            var rawData = responseText.match(/\{.*responseContext.*\:\{.*\:.*\}\}/g);

            if (rawData && rawData[0]) {
                try {
                    var data = JSON.parse(rawData[0]);

                    // dat chain o.O
                    var videos_data = data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents;
                    if (script.debug) { console.log(videos_data); }

                    // hide current suggestions and remove previously searched videos if any
                    showSuggestions(false);

                    var watch_related = document.querySelector('ytd-watch-next-secondary-results-renderer > #items');
                    forEach(videos_data, function(video_data) {
                        if (video_data.videoRenderer) {
                            watch_related.insertAdjacentHTML("beforeend", videoQueuePolymer(video_data.videoRenderer, "ytd-compact-video-renderer"));
                        } else if (video_data.radioRenderer) {
                            watch_related.insertAdjacentHTML("beforeend", videoQueuePolymer(video_data.radioRenderer, "ytd-compact-radio-renderer"));
                        } else if (video_data.playlistRenderer) {
                            watch_related.insertAdjacentHTML("beforeend", videoQueuePolymer(video_data.playlistRenderer, "ytd-compact-playlist-renderer"));
                        }
                    });
                } catch (error) {
                    alert("failed to retrieve search data, sorry! " + error.message);
                }
            }
        }

        // *** HTML & CSS *** //

        function videoQueueHTML(video) {
            var strVar = "";

            strVar += "<li class=\"video-list-item related-list-item show-video-time related-list-item-compact-video generated\">";
            strVar += "    <div class=\"related-item-dismissable\">";
            strVar += "        <div class=\"content-wrapper\">";
            strVar += "            <a href=\"\/watch?v=" + video.id + "\" class=\"yt-uix-sessionlink content-link spf-link spf-link\" rel=\"spf-prefetch\" title=\"" + video.title + "\">";
            strVar += "                <span dir=\"ltr\" class=\"title\">" + video.title + "<\/span>";
            strVar += "				   <span class=\"stat author\">" + video.author + "<\/span>";
            strVar += "				   <div class=\"yt-lockup-meta stat\">" + video.stats + "<\/div>";
            strVar += "            <\/a>";
            strVar += "        <\/div>";
            strVar += "        <div class=\"thumb-wrapper\">";
            strVar += "	           <a href=\"\/watch?v=" + video.id + "\" class=\"yt-uix-sessionlink thumb-link spf-link spf-link\" rel=\"spf-prefetch\" tabindex=\"-1\" aria-hidden=\"true\">";
            strVar += "                <span class=\"yt-uix-simple-thumb-wrap yt-uix-simple-thumb-related\" tabindex=\"0\" data-vid=\"" + video.id + "\">";
            strVar += "                    <img aria-hidden=\"true\" alt=\"\" src=\"" + video.iurlhq + "\">";
            strVar += "                <\/span>";
            strVar += "            <\/a>";
            strVar += "	           <span class=\"video-time\">"+ video.time +"<\/span>";
            strVar += "            <button class=\"yt-uix-button yt-uix-button-size-small yt-uix-button-default yt-uix-button-empty yt-uix-button-has-icon no-icon-markup addto-button video-actions spf-nolink hide-until-delayloaded addto-watch-later-button yt-uix-tooltip\" type=\"button\" onclick=\";return false;\" title=\"Watch Later\" role=\"button\" data-video-ids=\"" + video.id + "\" data-tooltip-text=\"Watch Later\"><\/button>";
            strVar += "        <\/div>";
            strVar += "    <\/div>";
            strVar += "<\/li>";

            video.html = strVar;
            return video;
        }

        function videoQueuePolymer(video_data, type) {
            return "<" + type + " data=\'" + JSON.stringify(video_data).replace(/\'/g, "&apos;") + "\' class=\"style-scope ytd-watch-next-secondary-results-renderer generated\" \/>";
        }

        function injectCSS() {
            var css;

            if (script.modern) {
                css = `
.autocomplete-suggestions {
    text-align: left; cursor: default; border: 1px solid var(--ytd-searchbox-legacy-border-color); border-top: 0; background: var(--yt-searchbox-background);
    position: absolute; display: none; z-index: 9999; max-height: 254px; overflow: hidden; overflow-y: auto; box-sizing: border-box; box-shadow: -1px 1px 3px rgba(0,0,0,.1);
}
.autocomplete-suggestion { position: relative; padding: 0 .6em; line-height: 23px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 1.22em; color: var(--yt-placeholder-text); }
.autocomplete-suggestion b { font-weight: normal; color: #b31217; }
.autocomplete-suggestion.selected { background: #ddd; }
[dark] .autocomplete-suggestion.selected { background: #333; }

ytd-compact-autoplay-renderer { padding-bottom: 0px; }

#suggestions-search {
    outline: none; width: 100%; padding: 6px 5px; margin: 8px 0 0 0;
    border: 1px solid var(--ytd-searchbox-legacy-border-color); border-radius: 2px 0 0 2px;
    box-shadow: inset 0 1px 2px var(--ytd-searchbox-legacy-border-shadow-color);
    color: var(--yt-searchbox-text-color); background-color: var(--yt-searchbox-background);
}
#suggestions-search.playlist-or-live { margin-bottom: 16px; }
`;
            } else {
                css = `
.autocomplete-suggestions {
    text-align: left; cursor: default; border: 1px solid #ccc; border-top: 0; background: #fff; box-shadow: -1px 1px 3px rgba(0,0,0,.1);
    position: absolute; display: none; z-index: 9999; max-height: 254px; overflow: hidden; overflow-y: auto; box-sizing: border-box;
}
.autocomplete-suggestion { position: relative; padding: 0 .6em; line-height: 23px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 1.02em; color: #333; }
.autocomplete-suggestion b { font-weight: normal; color: #b31217; }
.autocomplete-suggestion.selected { background: #f0f0f0; }

.yt-uix-simple-thumb-wrap > img { top: 0px; width: 168px; height: 94px; }
.watch-sidebar-body > div.search-pager { width: 97.5%; padding: 5px 5px; display: flex; justify-content: center; }
.watch-sidebar-body > div.search-pager > .yt-uix-button { margin: 0 1px; }

#suggestions-search { outline: none; width: 98%; padding: 5px 5px; margin: 0 4px; }
#suggestions-search.playlist-or-live { width: 97%; margin: 0 10px 10px 10px; }
`;
            }

            var style = document.createElement("style");
            style.type = "text/css";
            if (style.styleSheet){
                style.styleSheet.cssText = css;
            } else {
                style.appendChild(document.createTextNode(css));
            }

            (document.body || document.head || document.documentElement).appendChild(style);
        }

        // *** FUNCTIONALITY *** //

        function forEach(array, callback, scope) {
            for (var i = 0; i < array.length; i++) {
                callback.call(scope, array[i], i);
            }
        };

        // When you want to remove elements
        function forEachReverse(array, callback, scope) {
            for (var i = array.length - 1; i >= 0; i--) {
                callback.call(scope, array[i], i);
            }
        };
    }

    var autoCompleteScript = document.createElement('script');
    autoCompleteScript.appendChild(document.createTextNode('window.autoComplete = '+ autoComplete + ';'));
    (document.body || document.head || document.documentElement).appendChild(autoCompleteScript);

    var script = document.createElement('script');
    script.appendChild(document.createTextNode('('+ youtube_search_while_watching_video +')();'));
    (document.body || document.head || document.documentElement).appendChild(script);
})();
