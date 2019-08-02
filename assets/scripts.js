/*
 * This is free and unencumbered software released into the public domain.
 *
 * Anyone is free to copy, modify, publish, use, compile, sell, or
 * distribute this software, either in source code form or as a compiled
 * binary, for any purpose, commercial or non-commercial, and by any
 * means.
 *
 * In jurisdictions that recognize copyright laws, the author or authors
 * of this software dedicate any and all copyright interest in the
 * software to the public domain. We make this dedication for the benefit
 * of the public at large and to the detriment of our heirs and
 * successors. We intend this dedication to be an overt act of
 * relinquishment in perpetuity of all present and future rights to this
 * software under copyright law.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
 * OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 *
 * For more information, please refer to <http://unlicense.org>
 */

// Data
var segmentMap = SegmentMap;
var bv = bandersnatch.videos['80988062'].interactiveVideoMoments.value;
var choicePoints = bv.choicePointNavigatorMetadata.choicePointsMetadata.choicePoints;
var momentsBySegment = bv.momentsBySegment;
var segmentGroups = bv.segmentGroups;

// Persistent state
var ls = window.localStorage || {};
if (!('initialized' in ls)) {
	for (let k in bv.stateHistory)
		ls["persistentState_" + k] = JSON.stringify(bv.stateHistory[k]);
	ls['initialized'] = 't';
}

function msToString(ms) {
	return new Date(ms).toUTCString().split(' ')[4];
}

function getCurrentMs() {
	return Math.round(document.getElementById("video").currentTime * 1000.0);
}

function preconditionToJS(cond) {
	if (cond[0] == 'persistentState') {
		return 'JSON.parse(ls["persistentState_' + cond[1] + '"])';
	} else if (cond[0] == 'not') {
		return '!(' + preconditionToJS(cond[1]) + ')';
	} else if (cond[0] == 'and') {
		return '(' + cond.slice(1).map(preconditionToJS).join(' && ') + ')';
	} else if (cond[0] == 'or') {
		return '(' + cond.slice(1).map(preconditionToJS).join(' || ') + ')';
	} else if (cond[0] == 'eql' && cond.length == 3) {
		return '(' + cond.slice(1).map(preconditionToJS).join(' == ') + ')';
	} else if (cond === false) {
		return 'false';
	} else if (cond === true) {
		return 'true';
	} else if (typeof cond === 'string') {
		return JSON.stringify(cond);
	} else {
		console.log('unsupported condition!', cond);
		return 'true';
	}
}

function evalPrecondition(precondition, text) {
	if (precondition) {
		let cond = preconditionToJS(precondition);
		let match = eval(cond);
		console.log('precondition', text, ':', cond, '==', match);
		return match;
	}

	return true;
}

function checkPrecondition(preconditionId) {
	return evalPrecondition(bv.preconditions[preconditionId], preconditionId);
}

function resolveSegmentGroup(sg) {
	let results = [];
	for (let v of segmentGroups[sg]) {
		if (v.precondition) {
			if (!checkPrecondition(v.precondition))
				continue;
		}
		if (v.segmentGroup) {
			results.push(resolveSegmentGroup(v.segmentGroup));
		} else if (v.segment) {
			results.push(v.segment);
		} else {
			if (!checkPrecondition(v))
				continue;
			results.push(v);
		}
	}
	console.log('segment group', sg, '=>', results);
	return results[0];
}

/// Returns the segment ID at the given timestamp.
/// There will be exactly one segment for any timestamp within the video file.
function getSegmentId(ms) {
	for (const [k, v] of Object.entries(segmentMap.segments)) {
		if (ms >= v.startTimeMs && (!v.endTimeMs || ms < v.endTimeMs)) {
			return k;
		}
	}
	return null;
}

function getSegmentMs(segmentId) {
	return segmentMap.segments[segmentId].startTimeMs;
}

function getMoments(segmentId, ms) {
	let result = {};
	let moments = momentsBySegment[segmentId] || [];
	for (let i = 0; i < moments.length; i++) {
		let m = moments[i];
		let momentId = segmentId + '/' + i;
		if (ms >= m.startMs && ms < m.endMs && evalPrecondition(m.precondition, 'moment ' + momentId)) {
			result[momentId] = m;
		}
	}
	return result;
}

function newList(id) {
	var ul = document.getElementById(id);
	while (ul.firstChild) {
		ul.removeChild(ul.firstChild);
	}
	return ul;
}

function addItem(ul, text, url) {
	var li = document.createElement("li");
	var a = document.createElement("a");
	a.textContent = text;
	a.setAttribute('href', url);
	li.appendChild(a);
	ul.appendChild(li);
}

var nextChoice = -1;
var nextSegment = null;

function addZones(segmentId) {
	var ul = newList("interactionZones");
	let caption = 'currentSegment(' + segmentId + ')';
	addItem(ul, caption, 'javascript:playSegment("' + segmentId + '")');

	var segment = segmentMap.segments[segmentId];
	if (segment && segment.ui && segment.ui.interactionZones) {
		var index = 0;
		for (var z of segment.ui.interactionZones) {
			var startMs = z[0];
			var stopMs = z[1];
			let caption = segmentId + ' interactionZone ' + index;
			addItem(ul, caption, 'javascript:seek(' + startMs + ')');
			index++;
		}
	}

	ul = newList("nextSegments");
	if (segment) {
		for (const [k, v] of Object.entries(segment.next)) {
			let caption = k;
			if (segment.defaultNext == k)
				caption = '[' + caption + ']';
			addItem(ul, caption, 'javascript:playSegment("' + k + '")');
		}
	}
}

var currentChoiceMoment = null;

function addChoices(r) {
	currentChoiceMoment = r;
	nextChoice = -1;
	var ul = newList("choices");
	document.getElementById("choiceCaption").innerHTML = '';
	if (!r) return;

	nextChoice = r.defaultChoiceIndex;

	let index = 0;
	for (let x of r.choices) {
		var caption = r.defaultChoiceIndex == index ? '[' + x.text + ']' : x.text;
		addItem(ul, caption, 'javascript:choice(' + index + ')');
		index++;
	}

	if (r.id in choicePoints)
		document.getElementById("choiceCaption").innerHTML = choicePoints[r.id].description;
}

function momentStart(m, seeked) {
	console.log('momentStart', m, seeked);
	if (m.choices) {
		addChoices(m);
	}
	if (!seeked)
		applyImpression(m.impressionData);
}

function momentUpdate(m, ms) {
	//console.log('momentUpdate', m);
	if (m.choices) {
		var p = 100 - ((ms - m.startMs) * 100.0 / (m.endMs - m.startMs));
		document.getElementById("progress").style.width = p + '%';
	}
}

function momentEnd(m, seeked) {
	console.log('momentEnd', m, seeked);
	if (m.choices) {
		addChoices(null);
		document.getElementById("progress").style.width = 0;
	}
}

var timerId = 0;
var lastMs = 0;
var currentSegment;
var lastSegment = null;
var prevSegment = null; // for breadcrumbs
var segmentTransition = false;
var lastMoments = [];

function ontimeupdate(evt) {
	var ms = getCurrentMs();
	currentSegment = getSegmentId(ms);
	let segment = segmentMap.segments[currentSegment];

	if (timerId) {
		clearTimeout(timerId);
		timerId = 0;
	}

	// Distinguish between the user seeking manually with <video> controls,
	// and the video playing normally (past some timestamp / boundary).
	let timeElapsed = ms - lastMs;
	let seeked = timeElapsed < 0 || timeElapsed >= 2000;
	lastMs = ms;

	// Recalculate title and hash only when we pass some meaningful timestamp.
	let placeChanged = false;

	// Handle segment change
	if (lastSegment != currentSegment) {
		console.log('ontimeupdate', lastSegment, '->', currentSegment, ms, msToString(ms), seeked);
		prevSegment = lastSegment;
		lastSegment = currentSegment;
		if (!seeked && prevSegment) {
			if (playNextSegment(prevSegment)) {
				// playSegment decided to seek, which means that this
				// currentSegment is invalid, and a recursive
				// ontimeupdate invocation should have taken care of
				// things already. Return.
				return;
			}
		}
		addZones(currentSegment);
		placeChanged = true;
	}

	var naturalTransition = !seeked || segmentTransition;
	segmentTransition = false;

	var currentMoments = getMoments(currentSegment, ms);
	for (let k in lastMoments)
		if (!(k in currentMoments)) {
			momentEnd(lastMoments[k], !naturalTransition);
			placeChanged = true;
		}
	for (let k in lastMoments)
		if (k in currentMoments)
			momentUpdate(lastMoments[k], ms);
	for (let k in currentMoments)
		if (!(k in lastMoments)) {
			momentStart(currentMoments[k], !naturalTransition);
			placeChanged = true;
		}
	lastMoments = currentMoments;

	if (placeChanged) {
		let title = 'Bandersnatch';
		title += ' - Chapter ' + currentSegment;
		for (let k in currentMoments) {
			let m = currentMoments[k];
			if (m.type.substr(0, 6) == 'scene:') {
				if (m.id && m.id in choicePoints && choicePoints[m.id].description)
					title += ' - Choice "' + choicePoints[m.id].description + '"';
				else
					title += ' - Choice ' + (m.id || k);
			}
		}
		document.title = title;

		let hash = currentSegment;
		// Pick the moment which starts closer to the current timestamp.
		let bestMomentStart = segment ? segment.startTimeMs : 0;
		for (let k in currentMoments) {
			let m = currentMoments[k];
			if (m.startMs > bestMomentStart) {
				hash = k;
				bestMomentStart = m.startMs;
			}
		}
		hash = '#' + hash;
		lastHash = hash; // suppress onhashchange event
		location.hash = hash;
		ls.place = hash;
	}

	// ontimeupdate resolution is about a second. Augment it using timer.
	let nextEvent = segment ? segment.endTimeMs : 0;
	for (let k in currentMoments) {
		let m = currentMoments[k];
		if (m.endMs < nextEvent)
			nextEvent = m.endMs;
	}
	for (let m of momentsBySegment[currentSegment] || [])
		if (ms < m.startMs && m.startMs < nextEvent)
			nextEvent = m.startMs;
	var timeLeft = nextEvent - ms;
	if (timeLeft > 0)
		timerId = setTimeout(ontimeupdate, timeLeft);
}

function playNextSegment(prevSegment) {
	let nextSegment = null;
	if (nextChoice >= 0) {
		let x = currentChoiceMoment.choices[nextChoice];
		if (x.segmentId)
			nextSegment = x.segmentId;
		else if (x.sg)
			nextSegment = resolveSegmentGroup(x.sg);
		else
			nextSegment = null;
		console.log('choice', nextChoice, 'nextSegment', nextSegment);
		nextChoice = -1;
		applyImpression(x.impressionData);
	}

	if (!nextSegment && prevSegment && prevSegment in segmentGroups)
		nextSegment = resolveSegmentGroup(prevSegment);

	if (!nextSegment && prevSegment && segmentMap.segments[prevSegment].defaultNext)
		nextSegment = segmentMap.segments[prevSegment].defaultNext;

	if (!nextSegment)
		return false;

	let breadcrumb = 'breadcrumb_' + nextSegment;
	if (!(breadcrumb in ls))
		ls[breadcrumb] = prevSegment;

	segmentTransition = true;
	return playSegment(nextSegment, true);
}

function jumpForward() {
	var ms = getCurrentMs();
	var segmentId = getSegmentId(ms);

	var interactionMs = 0;
	let moments = momentsBySegment[segmentId] || [];
	// Find the earliest moment within this segment after cursor
	for (let m of moments)
		if (m.startMs > ms && (interactionMs == 0 || m.startMs < interactionMs))
			interactionMs = m.startMs;

	segmentTransition = true;
	if (interactionMs) {
		seek(interactionMs);
	} else {
		playNextSegment(segmentId);
	}
}

function jumpBack() {
	var ms = getCurrentMs();
	var segmentId = getSegmentId(ms);
	let segment = segmentMap.segments[segmentId];

	var interactionMs = 0;
	let moments = momentsBySegment[segmentId] || [];
	let inMoment = false;
	// Find the latest moment within this segment before cursor
	for (let m of moments) {
		if (m.endMs < ms && m.startMs > interactionMs)
			interactionMs = m.startMs;
		if (m.startMs != segment.startTimeMs && m.startMs <= ms && ms < m.endMs)
			inMoment = true;
	}

	segmentTransition = true;
	if (interactionMs) {
		seek(interactionMs);
	} else if (inMoment) {
		seek(segment.startTimeMs);
	} else {
		let breadcrumb = 'breadcrumb_' + segmentId;
		if (breadcrumb in ls) {
			// Jump to last moment in previous segment
			segmentId = ls[breadcrumb];
			segment = segmentMap.segments[segmentId];

			interactionMs = segment.startTimeMs;
			let moments = momentsBySegment[segmentId] || [];
			for (let m of moments)
				if (m.startMs > interactionMs)
					interactionMs = m.startMs;
			seek(interactionMs);
		} else {
			seek(0);
		}
	}
}

function toggleFullScreen() {
	console.log('toggleFullScreen');
	var c = document.getElementById("c");
	if (!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
		if (c.requestFullscreen) {
			c.requestFullscreen();
		} else if (c.msRequestFullscreen) {
			c.msRequestFullscreen();
		} else if (c.mozRequestFullScreen) {
			c.mozRequestFullScreen();
		} else if (c.webkitRequestFullscreen) {
			c.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
		}
	} else {
		if (document.exitFullscreen) {
			document.exitFullscreen();
		} else if (document.msExitFullscreen) {
			document.msExitFullscreen();
		} else if (document.mozCancelFullScreen) {
			document.mozCancelFullScreen();
		} else if (document.webkitExitFullscreen) {
			document.webkitExitFullscreen();
		}
	}
}

function togglePlayPause() {
	var v = document.getElementById("video");
	if (v.paused) v.play();
	else v.pause();
}

window.onload = function() {
	var video_selector = document.getElementById("video");
	var video_source_selector = document.getElementById("video-source");
	var file_selector = document.getElementById("file-selector");
	function startPlayback() {
		file_selector.style.display = 'none';
		if (window.location.hash)
			playHash(window.location.hash);
		else if (ls.place)
			playHash(ls.place);
		else
			playSegment(null);
		video_selector.play();
	}
	if (video_source_selector.getAttribute("src") == '') {
		console.log('no video');
		file_selector.style.display = 'table';
		document.getElementById("wrapper-video").style.display = 'none';
	} else {
		startPlayback();
	}
	document.getElementById('fileinput').addEventListener('change', function () {
		var file = this.files[0];
		var fileUrl = URL.createObjectURL(file);
		video_selector.src = fileUrl;
		document.getElementById("wrapper-video").style.display = 'block';
		startPlayback();
	}, false);

	video_selector.ontimeupdate = ontimeupdate;

	var c = document.getElementById("c");
	c.ondblclick = toggleFullScreen;
	video_selector.onclick = function (e) {
		togglePlayPause();
		e.preventDefault();
	};

	document.onkeypress = function (e) {
		if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey)
			return;
		if (e.code == 'KeyF')
			toggleFullScreen();
		if (e.code == 'KeyR')
			playSegment(0);
		if (e.code == 'Space')
			togglePlayPause();
	};
	video_selector.onkeydown = function(e) {
		if (e.code == 'Space')
			e.preventDefault();
	};

	document.onkeydown = function (e) {
		if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey)
			return;
		if (e.key == 'ArrowLeft')
			jumpBack();
		if (e.key == 'ArrowRight')
			jumpForward();
		if (e.key == 'ArrowUp')
			video_selector.playbackRate = video_selector.playbackRate * 2.0;
		if (e.key == 'ArrowDown')
			video_selector.playbackRate = video_selector.playbackRate / 2.0;
	};

	window.onhashchange = function() {
		playHash(window.location.hash);
	};
};

function seek(ms) {
	console.log('seek', ms);
	document.getElementById("video").currentTime = ms / 1000.0;
	ontimeupdate(null);
}

function choice(choiceIndex) {
	nextChoice = choiceIndex;
	newList("choices");
	if (!currentChoiceMoment.config.disableImmediateSceneTransition)
		playNextSegment(prevSegment);
}

function applyImpression(impressionData) {
	if (impressionData && impressionData.type == 'userState') {
		for (const [variable, value] of Object.entries(impressionData.data.persistent)) {
			let key = "persistentState_" + variable;
			console.log('persistentState set', variable, '=', value, '(was', key in ls ? ls[key] : 'unset', ')');
			ls[key] = JSON.stringify(value);
		}
	}
}

function playSegment(segmentId, noSeek) {
	if (!segmentId || typeof segmentId === "undefined")
		segmentId = segmentMap.initialSegment;
	var oldSegment = getSegmentId(getCurrentMs());
	console.log('playSegment', oldSegment, '->', segmentId);
	if (!noSeek || oldSegment != segmentId) {
		var ms = getSegmentMs(segmentId);
		seek(ms);
		return true;
	}
	return false;
}

function reset() {
	ls.clear();
	location.hash = '';
	location.reload();
}

var lastHash = '';
function playHash(hash) {
	// console.log('playHash', lastHash, '->', hash);
	if (hash == lastHash)
		return;
	lastHash = hash;
	if (hash) {
		hash = hash.slice(1);
		if (hash[0] == 't')
			seek(Number(Math.round(hash.slice(1) * 1000.0)));
		else {
			let loc = hash.split('/');
			let segmentId = loc[0];
			if (loc.length > 1)
				seek(momentsBySegment[segmentId][loc[1]].startMs);
			else
				seek(getSegmentMs(segmentId));
		}
	}
}
