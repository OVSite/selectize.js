/**
 * selectize.js
 * Copyright (c) 2013 Brian Reavis & contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this
 * file except in compliance with the License. You may obtain a copy of the License at:
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
 * ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 *
 * @author Brian Reavis <brian@thirdroute.com>
 */

var Selectize = function($input, settings) {
	var key, i, n;
	$input[0].selectize   = this;

	this.$input           = $input;
	this.tagType          = $input[0].tagName.toLowerCase() === 'select' ? TAG_SELECT : TAG_INPUT;
	this.settings         = settings;

	this.highlightedValue = null;
	this.isOpen           = false;
	this.isDisabled       = false;
	this.isLocked         = false;
	this.isFocused        = false;
	this.isInputFocused   = false;
	this.isInputHidden    = false;
	this.isSetup          = false;
	this.isShiftDown      = false;
	this.isCmdDown        = false;
	this.isCtrlDown       = false;
	this.ignoreFocus      = false;
	this.hasOptions       = false;
	this.currentResults   = null;
	this.lastValue        = '';
	this.caretPos         = 0;
	this.loading          = 0;
	this.loadedSearches   = {};

	this.$activeOption    = null;
	this.$activeItems     = [];

	this.optgroups        = {};
	this.options          = {};
	this.userOptions      = {};
	this.items            = [];
	this.renderCache      = {};
	this.onSearchChange   = debounce(this.onSearchChange, this.settings.loadThrottle);

	if ($.isArray(settings.options)) {
		key = settings.valueField;
		for (i = 0, n = settings.options.length; i < n; i++) {
			if (settings.options[i].hasOwnProperty(key)) {
				this.options[settings.options[i][key]] = settings.options[i];
			}
		}
	} else if (typeof settings.options === 'object') {
		$.extend(this.options, settings.options);
		delete this.settings.options;
	}

	if ($.isArray(settings.optgroups)) {
		key = settings.optgroupValueField;
		for (i = 0, n = settings.optgroups.length; i < n; i++) {
			if (settings.optgroups[i].hasOwnProperty(key)) {
				this.optgroups[settings.optgroups[i][key]] = settings.optgroups[i];
			}
		}
	} else if (typeof settings.optgroups === 'object') {
		$.extend(this.optgroups, settings.optgroups);
		delete this.settings.optgroups;
	}

	// option-dependent defaults
	this.settings.mode = this.settings.mode || (this.settings.maxItems === 1 ? 'single' : 'multi');
	if (typeof this.settings.hideSelected !== 'boolean') {
		this.settings.hideSelected = this.settings.mode === 'multi';
	}

	this.loadPlugins(this.settings.plugins);
	this.setupCallbacks();
	this.setup();
};

// mixins
// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

MicroEvent.mixin(Selectize);
Plugins.mixin(Selectize, 'Selectize');

// methods
// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

/**
 * Creates all elements and sets up event bindings.
 */
Selectize.prototype.setup = function() {
	var self = this;
	var $wrapper;
	var $control;
	var $control_input;
	var $dropdown;
	var $dropdown_content;
	var inputMode;
	var timeout_blur;
	var timeout_focus;
	var tab_index;
	var classes;

	tab_index         = this.$input.attr('tabindex') || '';
	classes           = this.$input.attr('class') || '';
	$wrapper          = $('<div>').addClass(this.settings.theme).addClass(this.settings.wrapperClass).addClass(classes);
	$control          = $('<div>').addClass(this.settings.inputClass).addClass('items').toggleClass('has-options', !$.isEmptyObject(this.options)).appendTo($wrapper);
	$control_input    = $('<input type="text">').appendTo($control).attr('tabindex',tab_index);
	$dropdown         = $('<div>').addClass(this.settings.dropdownClass).hide().appendTo($wrapper);
	$dropdown_content = $('<div>').addClass(this.settings.dropdownContentClass).appendTo($dropdown);

	$wrapper.css({
		width: this.$input[0].style.width,
		display: this.$input.css('display')
	});

	if (this.plugins.length) {
		$wrapper.addClass('plugin-' + this.plugins.join(' plugin-'));
	}

	inputMode = this.settings.mode;
	$wrapper.toggleClass('single', inputMode === 'single');
	$wrapper.toggleClass('multi', inputMode === 'multi');

	if ((this.settings.maxItems === null || this.settings.maxItems > 1) && this.tagType === TAG_SELECT) {
		this.$input.attr('multiple', 'multiple');
	}

	if (this.settings.placeholder) {
		$control_input.attr('placeholder', this.settings.placeholder);
	}

	this.$wrapper          = $wrapper;
	this.$control          = $control;
	this.$control_input    = $control_input;
	this.$dropdown         = $dropdown;
	this.$dropdown_content = $dropdown_content;

	$control.on('mousedown', function(e) {
		if (!e.isDefaultPrevented()) {
			window.setTimeout(function() {
				self.focus(true);
			}, 0);
		}
	});

	$dropdown.on('mouseenter', '[data-selectable]', function() { return self.onOptionHover.apply(self, arguments); });
	$dropdown.on('mousedown', '[data-selectable]', function() { return self.onOptionSelect.apply(self, arguments); });
	watchChildEvent($control, 'mousedown', '*:not(input)', function() { return self.onItemSelect.apply(self, arguments); });
	autoGrow($control_input);

	$control_input.on({
		mousedown : function(e) { e.stopPropagation(); },
		keydown   : function() { return self.onKeyDown.apply(self, arguments); },
		keyup     : function() { return self.onKeyUp.apply(self, arguments); },
		keypress  : function() { return self.onKeyPress.apply(self, arguments); },
		resize    : function() { self.positionDropdown.apply(self, []); },
		blur      : function() { return self.onBlur.apply(self, arguments); },
		focus     : function() { return self.onFocus.apply(self, arguments); }
	});

	$(document).on({
		keydown: function(e) {
			self.isCmdDown = e[IS_MAC ? 'metaKey' : 'ctrlKey'];
			self.isCtrlDown = e[IS_MAC ? 'altKey' : 'ctrlKey'];
			self.isShiftDown = e.shiftKey;
		},
		keyup: function(e) {
			if (e.keyCode === KEY_CTRL) self.isCtrlDown = false;
			if (e.keyCode === KEY_SHIFT) self.isShiftDown = false;
			if (e.keyCode === KEY_CMD) self.isCmdDown = false;
		},
		mousedown: function(e) {
			if (self.isFocused) {
				// prevent events on the dropdown scrollbar from causing the control to blur
				if (e.target === self.$dropdown[0]) {
					var ignoreFocus = self.ignoreFocus;
					self.ignoreFocus = true;
					window.setTimeout(function() {
						self.ignoreFocus = ignoreFocus;
						self.focus(false);
					}, 0);
					return;
				}
				// blur on click outside
				if (!self.$control.has(e.target).length && e.target !== self.$control[0]) {
					self.blur();
				}
			}
		}
	});

	$(window).on({
		resize: function() {
			if (self.isOpen) {
				self.positionDropdown.apply(self, arguments);
			}
		}
	});

	this.$input.attr('tabindex',-1).hide().after(this.$wrapper);

	if ($.isArray(this.settings.items)) {
		this.setValue(this.settings.items);
		delete this.settings.items;
	}

	this.updateOriginalInput();
	this.refreshItems();
	this.updatePlaceholder();
	this.isSetup = true;

	if (this.$input.is(':disabled')) {
		this.disable();
	}

	// preload options
	if (this.settings.preload) {
		this.onSearchChange('');
	}
};

/**
 * Maps fired events to callbacks provided
 * in the settings used when creating the control.
 */
Selectize.prototype.setupCallbacks = function() {
	var key, fn, callbacks = {
		'change'         : 'onChange',
		'item_add'       : 'onItemAdd',
		'item_remove'    : 'onItemRemove',
		'clear'          : 'onClear',
		'option_add'     : 'onOptionAdd',
		'option_remove'  : 'onOptionRemove',
		'option_clear'   : 'onOptionClear',
		'dropdown_open'  : 'onDropdownOpen',
		'dropdown_close' : 'onDropdownClose',
		'type'           : 'onType'
	};

	for (key in callbacks) {
		if (callbacks.hasOwnProperty(key)) {
			fn = this.settings[callbacks[key]];
			if (fn) this.on(key, fn);
		}
	}
};

/**
 * Triggers a callback defined in the user-provided settings.
 * Events: onItemAdd, onOptionAdd, etc
 *
 * @param {string} event
 */
Selectize.prototype.triggerCallback = function(event) {
	var args;
	if (typeof this.settings[event] === 'function') {
		args = Array.prototype.slice.apply(arguments, [1]);
		this.settings[event].apply(this, args);
	}
};

/**
 * Triggered on <input> keypress.
 *
 * @param {object} e
 * @returns {boolean}
 */
Selectize.prototype.onKeyPress = function(e) {
	if (this.isLocked) return e && e.preventDefault();
	var character = String.fromCharCode(e.keyCode || e.which);
	if (this.settings.create && character === this.settings.delimiter) {
		this.createItem();
		e.preventDefault();
		return false;
	}
};

/**
 * Triggered on <input> keydown.
 *
 * @param {object} e
 * @returns {boolean}
 */
Selectize.prototype.onKeyDown = function(e) {
	var isInput = e.target === this.$control_input[0];

	if (this.isLocked) {
		if (e.keyCode !== KEY_TAB) {
			e.preventDefault();
		}
		return;
	}

	switch (e.keyCode) {
		case KEY_A:
			if (this.isCmdDown) {
				this.selectAll();
				e.preventDefault();
				return;
			}
			break;
		case KEY_ESC:
			this.blur();
			return;
		case KEY_DOWN:
			if (!this.isOpen && this.hasOptions) {
				this.open();
			} else if (this.$activeOption) {
				var $next = this.getAdjacentOption(this.$activeOption, 1);
				if ($next.length) this.setActiveOption($next, true, true);
			}
			e.preventDefault();
			return;
		case KEY_UP:
			if (this.$activeOption) {
				var $prev = this.getAdjacentOption(this.$activeOption, -1);
				if ($prev.length) this.setActiveOption($prev, true, true);
			}
			e.preventDefault();
			return;
		case KEY_RETURN:
			if (this.$activeOption) {
				this.onOptionSelect({currentTarget: this.$activeOption});
			}
			e.preventDefault();
			return;
		case KEY_LEFT:
			this.advanceSelection(-1, e);
			return;
		case KEY_RIGHT:
			this.advanceSelection(1, e);
			return;
		case KEY_TAB:
			if (this.settings.create && $.trim(this.$control_input.val()).length) {
				this.createItem();
				e.preventDefault();
			}
			return;
		case KEY_BACKSPACE:
		case KEY_DELETE:
			this.deleteSelection(e);
			return;
	}
	if (this.isFull() || this.isInputHidden) {
		e.preventDefault();
		return;
	}
};

/**
 * Triggered on <input> keyup.
 *
 * @param {object} e
 * @returns {boolean}
 */
Selectize.prototype.onKeyUp = function(e) {
	if (this.isLocked) return e && e.preventDefault();
	var value = this.$control_input.val() || '';
	if (this.lastValue !== value) {
		this.lastValue = value;
		this.onSearchChange(value);
		this.refreshOptions();
		this.trigger('type', value);
	}
};

/**
 * Invokes the user-provide option provider / loader.
 *
 * Note: this function is debounced in the Selectize
 * constructor (by `settings.loadDelay` milliseconds)
 *
 * @param {string} value
 */
Selectize.prototype.onSearchChange = function(value) {
	var self = this;
	var fn = self.settings.load;
	if (!fn) return;
	if (self.loadedSearches.hasOwnProperty(value)) return;
	self.loadedSearches[value] = true;
	self.load(function(callback) {
		fn.apply(self, [value, callback]);
	});
};

/**
 * Triggered on <input> focus.
 *
 * @param {object} e (optional)
 * @returns {boolean}
 */
Selectize.prototype.onFocus = function(e) {
	this.isInputFocused = true;
	this.isFocused = true;
	if (this.isDisabled) {
		this.blur();
		e.preventDefault();
		return false;
	}
	if (this.ignoreFocus) return;

	this.showInput();
	this.setActiveItem(null);
	this.refreshOptions(!!this.settings.openOnFocus);
	this.refreshClasses();
};

/**
 * Triggered on <input> blur.
 *
 * @param {object} e
 * @returns {boolean}
 */
Selectize.prototype.onBlur = function(e) {
	this.isInputFocused = false;
	if (this.ignoreFocus) return;

	this.close();
	this.setTextboxValue('');
	this.setActiveOption(null);
	this.setCaret(this.items.length);
	this.isFocused = false;
	this.refreshClasses();
};

/**
 * Triggered when the user rolls over
 * an option in the autocomplete dropdown menu.
 *
 * @param {object} e
 * @returns {boolean}
 */
Selectize.prototype.onOptionHover = function(e) {
	this.setActiveOption(e.currentTarget, false);
};

/**
 * Triggered when the user clicks on an option
 * in the autocomplete dropdown menu.
 *
 * @param {object} e
 * @returns {boolean}
 */
Selectize.prototype.onOptionSelect = function(e) {
	e.preventDefault && e.preventDefault();
	e.stopPropagation && e.stopPropagation();
	this.focus(false);

	var $target = $(e.currentTarget);
	if ($target.hasClass('create')) {
		this.createItem();
	} else {
		var value = $target.attr('data-value');
		if (value) {
			this.setTextboxValue('');
			this.addItem(value);
		}
	}
};

/**
 * Triggered when the user clicks on an item
 * that has been selected.
 *
 * @param {object} e
 * @returns {boolean}
 */
Selectize.prototype.onItemSelect = function(e) {
	if (this.settings.mode === 'multi') {
		e.preventDefault();
		this.setActiveItem(e.currentTarget, e);
		this.focus(false);
		this.hideInput();
	}
};

/**
 * Invokes the provided method that provides
 * results to a callback---which are then added
 * as options to the control.
 *
 * @param {function} fn
 */
Selectize.prototype.load = function(fn) {
	var self = this;
	var $wrapper = self.$wrapper.addClass('loading');

	self.loading++;
	fn.apply(self, [function(results) {
		self.loading = Math.max(self.loading - 1, 0);
		if (results && results.length) {
			self.addOption(results);
			self.refreshOptions(false);
			if (self.isInputFocused) self.open();
		}
		if (!self.loading) {
			$wrapper.removeClass('loading');
		}
		self.trigger('load', results);
	}]);
};

/**
 * Sets the input field of the control to the specified value.
 *
 * @param {string} value
 */
Selectize.prototype.setTextboxValue = function(value) {
	this.$control_input.val(value).triggerHandler('update');
	this.lastValue = value;
};

/**
 * Returns the value of the control. If multiple items
 * can be selected (e.g. <select multiple>), this returns
 * an array. If only one item can be selected, this
 * returns a string.
 *
 * @returns {mixed}
 */
Selectize.prototype.getValue = function() {
	if (this.tagType === TAG_SELECT && this.$input.attr('multiple')) {
		return this.items;
	} else {
		return this.items.join(this.settings.delimiter);
	}
};

/**
 * Resets the selected items to the given value.
 *
 * @param {mixed} value
 */
Selectize.prototype.setValue = function(value) {
	debounce_events(this, ['change'], function() {
		this.clear();
		var items = $.isArray(value) ? value : [value];
		for (var i = 0, n = items.length; i < n; i++) {
			this.addItem(items[i]);
		}
	});
};

/**
 * Sets the selected item.
 *
 * @param {object} $item
 * @param {object} e (optional)
 */
Selectize.prototype.setActiveItem = function($item, e) {
	var eventName;
	var i, idx, begin, end, item, swap;
	var $last;

	$item = $($item);

	// clear the active selection
	if (!$item.length) {
		$(this.$activeItems).removeClass('active');
		this.$activeItems = [];
		this.isFocused = this.isInputFocused;
		return;
	}

	// modify selection
	eventName = e && e.type.toLowerCase();

	if (eventName === 'mousedown' && this.isShiftDown && this.$activeItems.length) {
		$last = this.$control.children('.active:last');
		begin = Array.prototype.indexOf.apply(this.$control[0].childNodes, [$last[0]]);
		end   = Array.prototype.indexOf.apply(this.$control[0].childNodes, [$item[0]]);
		if (begin > end) {
			swap  = begin;
			begin = end;
			end   = swap;
		}
		for (i = begin; i <= end; i++) {
			item = this.$control[0].childNodes[i];
			if (this.$activeItems.indexOf(item) === -1) {
				$(item).addClass('active');
				this.$activeItems.push(item);
			}
		}
		e.preventDefault();
	} else if ((eventName === 'mousedown' && this.isCtrlDown) || (eventName === 'keydown' && this.isShiftDown)) {
		if ($item.hasClass('active')) {
			idx = this.$activeItems.indexOf($item[0]);
			this.$activeItems.splice(idx, 1);
			$item.removeClass('active');
		} else {
			this.$activeItems.push($item.addClass('active')[0]);
		}
	} else {
		$(this.$activeItems).removeClass('active');
		this.$activeItems = [$item.addClass('active')[0]];
	}

	this.isFocused = !!this.$activeItems.length || this.isInputFocused;
};

/**
 * Sets the selected item in the dropdown menu
 * of available options.
 *
 * @param {object} $object
 * @param {boolean} scroll
 * @param {boolean} animate
 */
Selectize.prototype.setActiveOption = function($option, scroll, animate) {
	var height_menu, height_item, y;
	var scroll_top, scroll_bottom;

	if (this.$activeOption) this.$activeOption.removeClass('active');
	this.$activeOption = null;

	$option = $($option);
	if (!$option.length) return;

	this.$activeOption = $option.addClass('active');

	if (scroll || !isset(scroll)) {

		height_menu   = this.$dropdown.height();
		height_item   = this.$activeOption.outerHeight(true);
		scroll        = this.$dropdown.scrollTop() || 0;
		y             = this.$activeOption.offset().top - this.$dropdown.offset().top + scroll;
		scroll_top    = y;
		scroll_bottom = y - height_menu + height_item;

		if (y + height_item > height_menu - scroll) {
			this.$dropdown.stop().animate({scrollTop: scroll_bottom}, animate ? this.settings.scrollDuration : 0);
		} else if (y < scroll) {
			this.$dropdown.stop().animate({scrollTop: scroll_top}, animate ? this.settings.scrollDuration : 0);
		}

	}
};

/**
 * Selects all items (CTRL + A).
 */
Selectize.prototype.selectAll = function() {
	this.$activeItems = Array.prototype.slice.apply(this.$control.children(':not(input)').addClass('active'));
	this.isFocused = true;
	if (this.$activeItems.length) this.hideInput();
};

/**
 * Hides the input element out of view, while
 * retaining its focus.
 */
Selectize.prototype.hideInput = function() {
	this.close();
	this.setTextboxValue('');
	this.$control_input.css({opacity: 0, position: 'absolute', left: -10000});
	this.isInputHidden = true;
};

/**
 * Restores input visibility.
 */
Selectize.prototype.showInput = function() {
	this.$control_input.css({opacity: 1, position: 'relative', left: 0});
	this.isInputHidden = false;
};

/**
 * Gives the control focus. If "trigger" is falsy,
 * focus handlers won't be fired--causing the focus
 * to happen silently in the background.
 *
 * @param {boolean} trigger
 */
Selectize.prototype.focus = function(trigger) {
	if (this.isDisabled) return;
	var self = this;
	self.ignoreFocus = true;
	self.$control_input[0].focus();
	self.isInputFocused = true;
	window.setTimeout(function() {
		self.ignoreFocus = false;
		if (trigger) self.onFocus();
	}, 0);
};

/**
 * Forces the control out of focus.
 */
Selectize.prototype.blur = function() {
	this.$control_input.trigger('blur');
	this.setActiveItem(null);
};

/**
 * Splits a search string into an array of
 * individual regexps to be used to match results.
 *
 * @param {string} query
 * @returns {array}
 */
Selectize.prototype.parseSearchTokens = function(query) {
	query = $.trim(String(query || '').toLowerCase());
	if (!query || !query.length) return [];

	var i, n, regex, letter;
	var tokens = [];
	var words = query.split(/ +/);

	for (i = 0, n = words.length; i < n; i++) {
		regex = quoteRegExp(words[i]);
		if (this.settings.diacritics) {
			for (letter in DIACRITICS) {
				if (DIACRITICS.hasOwnProperty(letter)) {
					regex = regex.replace(new RegExp(letter, 'g'), DIACRITICS[letter]);
				}
			}
		}
		tokens.push({
			string : words[i],
			regex  : new RegExp(regex, 'i')
		});
	}

	return tokens;
};

/**
 * Returns a function to be used to score individual results.
 * Results will be sorted by the score (descending). Scores less
 * than or equal to zero (no match) will not be included in the results.
 *
 * @param {object} data
 * @param {object} search
 * @returns {function}
 */
Selectize.prototype.getScoreFunction = function(search) {
	var self = this;
	var tokens = search.tokens;

	var calculateFieldScore = (function() {
		if (!tokens.length) {
			return function() { return 0; };
		} else if (tokens.length === 1) {
			return function(value) {
				var score, pos;

				value = String(value || '').toLowerCase();
				pos = value.search(tokens[0].regex);
				if (pos === -1) return 0;
				score = tokens[0].string.length / value.length;
				if (pos === 0) score += 0.5;
				return score;
			};
		} else {
			return function(value) {
				var score, pos, i, j;

				value = String(value || '').toLowerCase();
				score = 0;
				for (i = 0, j = tokens.length; i < j; i++) {
					pos = value.search(tokens[i].regex);
					if (pos === -1) return 0;
					if (pos === 0) score += 0.5;
					score += tokens[i].string.length / value.length;
				}
				return score / tokens.length;
			};
		}
	})();

	var calculateScore = (function() {
		var fields = self.settings.searchField;
		if (typeof fields === 'string') {
			fields = [fields];
		}
		if (!fields || !fields.length) {
			return function() { return 0; };
		} else if (fields.length === 1) {
			var field = fields[0];
			return function(data) {
				if (!data.hasOwnProperty(field)) return 0;
				return calculateFieldScore(data[field]);
			};
		} else {
			return function(data) {
				var n = 0;
				var score = 0;
				for (var i = 0, j = fields.length; i < j; i++) {
					if (data.hasOwnProperty(fields[i])) {
						score += calculateFieldScore(data[fields[i]]);
						n++;
					}
				}
				return score / n;
			};
		}
	})();

	return calculateScore;
};

/**
 * Searches through available options and returns
 * a sorted array of matches. Includes options that
 * have already been selected.
 *
 * The `settings` parameter can contain:
 *
 *   - searchField
 *   - sortField
 *   - sortDirection
 *
 * Returns an object containing:
 *
 *   - query {string}
 *   - tokens {array}
 *   - total {int}
 *   - items {array}
 *
 * @param {string} query
 * @param {object} settings
 * @returns {object}
 */
Selectize.prototype.search = function(query, settings) {
	var self = this;
	var value, score, search, calculateScore;

	settings = settings || {};
	query = $.trim(String(query || '').toLowerCase());

	if (query !== this.lastQuery) {
		this.lastQuery = query;

		search = {
			query  : query,
			tokens : this.parseSearchTokens(query),
			total  : 0,
			items  : []
		};

		// generate result scoring function
		if (this.settings.score) {
			calculateScore = this.settings.score.apply(this, [search]);
			if (typeof calculateScore !== 'function') {
				throw new Error('Selectize "score" setting must be a function that returns a function');
			}
		} else {
			calculateScore = this.getScoreFunction(search);
		}

		// perform search and sort
		if (query.length) {
			for (value in this.options) {
				if (this.options.hasOwnProperty(value)) {
					score = calculateScore(this.options[value]);
					if (score > 0) {
						search.items.push({
							score: score,
							value: value
						});
					}
				}
			}
			search.items.sort(function(a, b) {
				return b.score - a.score;
			});
		} else {
			for (value in this.options) {
				if (this.options.hasOwnProperty(value)) {
					search.items.push({
						score: 1,
						value: value
					});
				}
			}
			if (this.settings.sortField) {
				search.items.sort((function() {
					var field = self.settings.sortField;
					var multiplier = self.settings.sortDirection === 'desc' ? -1 : 1;
					return function(a, b) {
						a = a && String(self.options[a.value][field] || '').toLowerCase();
						b = b && String(self.options[b.value][field] || '').toLowerCase();
						if (a > b) return 1 * multiplier;
						if (b > a) return -1 * multiplier;
						return 0;
					};
				})());
			}
		}
		this.currentResults = search;
	} else {
		search = $.extend(true, {}, this.currentResults);
	}

	// apply limits and return
	return this.prepareResults(search, settings);
};

/**
 * Filters out any items that have already been selected
 * and applies search limits.
 *
 * @param {object} results
 * @param {object} settings
 * @returns {object}
 */
Selectize.prototype.prepareResults = function(search, settings) {
	if (this.settings.hideSelected) {
		for (var i = search.items.length - 1; i >= 0; i--) {
			if (this.items.indexOf(String(search.items[i].value)) !== -1) {
				search.items.splice(i, 1);
			}
		}
	}

	search.total = search.items.length;
	if (typeof settings.limit === 'number') {
		search.items = search.items.slice(0, settings.limit);
	}

	return search;
};

/**
 * Refreshes the list of available options shown
 * in the autocomplete dropdown menu.
 *
 * @param {boolean} triggerDropdown
 */
Selectize.prototype.refreshOptions = function(triggerDropdown) {
	if (typeof triggerDropdown === 'undefined') {
		triggerDropdown = true;
	}

	var i, n, groups, groups_order, option, optgroup, html, html_children;
	var hasCreateOption;
	var query = this.$control_input.val();
	var results = this.search(query, {});
	var $active, $create;
	var $dropdown_content = this.$dropdown_content;

	// build markup
	n = results.items.length;
	if (typeof this.settings.maxOptions === 'number') {
		n = Math.min(n, this.settings.maxOptions);
	}

	// render and group available options individually
	groups = {};

	if (this.settings.optgroupOrder) {
		groups_order = this.settings.optgroupOrder;
		for (i = 0; i < groups_order.length; i++) {
			groups[groups_order[i]] = [];
		}
	} else {
		groups_order = [];
	}

	for (i = 0; i < n; i++) {
		option = this.options[results.items[i].value];
		optgroup = option[this.settings.optgroupField] || '';
		if (!this.optgroups.hasOwnProperty(optgroup)) {
			optgroup = '';
		}
		if (!groups.hasOwnProperty(optgroup)) {
			groups[optgroup] = [];
			groups_order.push(optgroup);
		}
		groups[optgroup].push(this.render('option', option));
	}

	// render optgroup headers & join groups
	html = [];
	for (i = 0, n = groups_order.length; i < n; i++) {
		optgroup = groups_order[i];
		if (this.optgroups.hasOwnProperty(optgroup) && groups[optgroup].length) {
			// render the optgroup header and options within it,
			// then pass it to the wrapper template
			html_children = this.render('optgroup_header', this.optgroups[optgroup]) || '';
			html_children += groups[optgroup].join('');
			html.push(this.render('optgroup', $.extend({}, this.optgroups[optgroup], {
				html: html_children
			})));
		} else {
			html.push(groups[optgroup].join(''));
		}
	}

	$dropdown_content.html(html.join(''));

	// highlight matching terms inline
	if (this.settings.highlight && results.query.length && results.tokens.length) {
		for (i = 0, n = results.tokens.length; i < n; i++) {
			highlight($dropdown_content, results.tokens[i].regex);
		}
	}

	// add "selected" class to selected options
	if (!this.settings.hideSelected) {
		for (i = 0, n = this.items.length; i < n; i++) {
			this.getOption(this.items[i]).addClass('selected');
		}
	}

	// add create option
	hasCreateOption = this.settings.create && results.query.length;
	if (hasCreateOption) {
		$dropdown_content.prepend(this.render('option_create', {input: query}));
		$create = $($dropdown_content[0].childNodes[0]);
	}

	// activate
	this.hasOptions = results.items.length > 0 || hasCreateOption;
	if (this.hasOptions) {
		if (results.items.length > 0) {
			if ($create) {
				$active = this.getAdjacentOption($create, 1);
			} else {
				$active = $dropdown_content.find("[data-selectable]").first();
			}
		} else {
			$active = $create;
		}
		this.setActiveOption($active);
		if (triggerDropdown && !this.isOpen) { this.open(); }
	} else {
		this.setActiveOption(null);
		if (triggerDropdown && this.isOpen) { this.close(); }
	}
};

/**
 * Adds an available option. If it already exists,
 * nothing will happen. Note: this does not refresh
 * the options list dropdown (use `refreshOptions`
 * for that).
 *
 * Usage:
 *
 *   this.addOption(value, data)
 *   this.addOption(data)
 *
 * @param {string} value
 * @param {object} data
 */
Selectize.prototype.addOption = function(value, data) {
	var i, n, optgroup;

	if ($.isArray(value)) {
		for (i = 0, n = value.length; i < n; i++) {
			this.addOption(value[i][this.settings.valueField], value[i]);
		}
		return;
	}

	value = value || '';
	if (this.options.hasOwnProperty(value)) return;

	this.userOptions[value] = true;
	this.options[value] = data;
	this.lastQuery = null;
	this.trigger('option_add', value, data);
};

/**
 * Registers a new optgroup for options
 * to be bucketed into.
 *
 * @param {string} id
 * @param {object} data
 */
Selectize.prototype.addOptionGroup = function(id, data) {
	this.optgroups[id] = data;
	this.trigger('optgroup_add', value, data);
};

/**
 * Updates an option available for selection. If
 * it is visible in the selected items or options
 * dropdown, it will be re-rendered automatically.
 *
 * @param {string} value
 * @param {object} data
 */
Selectize.prototype.updateOption = function(value, data) {
	value = String(value);
	this.options[value] = data;
	if (isset(this.renderCache['item'])) delete this.renderCache['item'][value];
	if (isset(this.renderCache['option'])) delete this.renderCache['option'][value];

	if (this.items.indexOf(value) !== -1) {
		var $item = this.getItem(value);
		var $item_new = $(this.render('item', data));
		if ($item.hasClass('active')) $item_new.addClass('active');
		$item.replaceWith($item_new);
	}

	if (this.isOpen) {
		this.refreshOptions(false);
	}
};

/**
 * Removes a single option.
 *
 * @param {string} value
 */
Selectize.prototype.removeOption = function(value) {
	value = String(value);
	delete this.userOptions[value];
	delete this.options[value];
	this.lastQuery = null;
	this.trigger('option_remove', value);
	this.removeItem(value);
};

/**
 * Clears all options.
 */
Selectize.prototype.clearOptions = function() {
	this.loadedSearches = {};
	this.userOptions = {};
	this.options = {};
	this.lastQuery = null;
	this.trigger('option_clear');
	this.clear();
};

/**
 * Returns the jQuery element of the option
 * matching the given value.
 *
 * @param {string} value
 * @returns {object}
 */
Selectize.prototype.getOption = function(value) {
	return value ? this.$dropdown_content.find('[data-selectable]').filter('[data-value="' + value.replace(/(['"])/g, '\\$1') + '"]:first') : $();
};

/**
 * Returns the jQuery element of the next or
 * previous selectable option.
 *
 * @param {object} $option
 * @param {int} direction  can be 1 for next or -1 for previous
 * @return {object}
 */
Selectize.prototype.getAdjacentOption = function($option, direction) {
	var $options = this.$dropdown.find('[data-selectable]');
	var index    = $options.index($option) + direction;

	return index >= 0 && index < $options.length ? $options.eq(index) : $();
};

/**
 * Returns the jQuery element of the item
 * matching the given value.
 *
 * @param {string} value
 * @returns {object}
 */
Selectize.prototype.getItem = function(value) {
	var i = this.items.indexOf(value);
	if (i !== -1) {
		if (i >= this.caretPos) i++;
		var $el = $(this.$control[0].childNodes[i]);
		if ($el.attr('data-value') === value) {
			return $el;
		}
	}
	return $();
};

/**
 * "Selects" an item. Adds it to the list
 * at the current caret position.
 *
 * @param {string} value
 */
Selectize.prototype.addItem = function(value) {
	debounce_events(this, ['change'], function() {
		var $item, $option;
		var self = this;
		var inputMode = this.settings.mode;
		var i, active, options, value_next;
		value = String(value);

		if (inputMode === 'single') this.clear();
		if (inputMode === 'multi' && this.isFull()) return;
		if (this.items.indexOf(value) !== -1) return;
		if (!this.options.hasOwnProperty(value)) return;

		$item = $(this.render('item', this.options[value]));
		this.items.splice(this.caretPos, 0, value);
		this.insertAtCaret($item);
		this.refreshClasses();

		if (this.isSetup) {
			// remove the option from the menu
			options = this.$dropdown_content.find('[data-selectable]');
			$option = this.getOption(value);
			value_next = this.getAdjacentOption($option, 1).attr('data-value');
			this.refreshOptions(true);
			if (value_next) {
				this.setActiveOption(this.getOption(value_next));
			}

			// hide the menu if the maximum number of items have been selected or no options are left
			if (!options.length || (this.settings.maxItems !== null && this.items.length >= this.settings.maxItems)) {
				this.close();
			} else {
				this.positionDropdown();
			}

			// restore focus to input
			if (this.isFocused) {
				window.setTimeout(function() {
					if (inputMode === 'single') {
						self.blur();
						self.focus(false);
						self.hideInput();
					} else {
						self.focus(false);
					}
				}, 0);
			}

			this.updatePlaceholder();
			this.trigger('item_add', value, $item);
			this.updateOriginalInput();
		}
	});
};

/**
 * Removes the selected item matching
 * the provided value.
 *
 * @param {string} value
 */
Selectize.prototype.removeItem = function(value) {
	var $item, i, idx;

	$item = (typeof value === 'object') ? value : this.getItem(value);
	value = String($item.attr('data-value'));
	i = this.items.indexOf(value);

	if (i !== -1) {
		$item.remove();
		if ($item.hasClass('active')) {
			idx = this.$activeItems.indexOf($item[0]);
			this.$activeItems.splice(idx, 1);
		}

		this.items.splice(i, 1);
		this.lastQuery = null;
		if (!this.settings.persist && this.userOptions.hasOwnProperty(value)) {
			this.removeOption(value);
		}

		if (i < this.caretPos) {
			this.setCaret(this.caretPos - 1);
		}

		this.refreshClasses();
		this.updatePlaceholder();
		this.updateOriginalInput();
		this.positionDropdown();
		this.trigger('item_remove', value);
	}
};

/**
 * Invokes the `create` method provided in the
 * selectize options that should provide the data
 * for the new item, given the user input.
 *
 * Once this completes, it will be added
 * to the item list.
 */
Selectize.prototype.createItem = function() {
	var self = this;
	var input = $.trim(this.$control_input.val() || '');
	var caret = this.caretPos;
	if (!input.length) return;
	this.lock();

	var setup = (typeof this.settings.create === 'function') ? this.settings.create : function(input) {
		var data = {};
		data[self.settings.labelField] = input;
		data[self.settings.valueField] = input;
		return data;
	};

	var create = once(function(data) {
		self.unlock();
		self.focus(false);

		var value = data && data[self.settings.valueField];
		if (!value) return;

		self.setTextboxValue('');
		self.addOption(value, data);
		self.setCaret(caret);
		self.addItem(value);
		self.refreshOptions(true);
		self.focus(false);
	});

	var output = setup.apply(this, [input, create]);
	if (typeof output !== 'undefined') {
		create(output);
	}
};

/**
 * Re-renders the selected item lists.
 */
Selectize.prototype.refreshItems = function() {
	this.lastQuery = null;

	if (this.isSetup) {
		for (var i = 0; i < this.items.length; i++) {
			this.addItem(this.items);
		}
	}

	this.refreshClasses();
	this.updateOriginalInput();
};

/**
 * Updates all state-dependent CSS classes.
 */
Selectize.prototype.refreshClasses = function() {
	var isFull = this.isFull();
	var isLocked = this.isLocked;
	this.$control
		.toggleClass('focus', this.isFocused)
		.toggleClass('disabled', this.isDisabled)
		.toggleClass('locked', isLocked)
		.toggleClass('full', isFull).toggleClass('not-full', !isFull)
		.toggleClass('has-items', this.items.length > 0);
	this.$control_input.data('grow', !isFull && !isLocked);
};

/**
 * Determines whether or not more items can be added
 * to the control without exceeding the user-defined maximum.
 *
 * @returns {boolean}
 */
Selectize.prototype.isFull = function() {
	return this.settings.maxItems !== null && this.items.length >= this.settings.maxItems;
};

/**
 * Refreshes the original <select> or <input>
 * element to reflect the current state.
 */
Selectize.prototype.updateOriginalInput = function() {
	var i, n, options;

	if (this.$input[0].tagName.toLowerCase() === 'select') {
		options = [];
		for (i = 0, n = this.items.length; i < n; i++) {
			options.push('<option value="' + htmlEntities(this.items[i]) + '" selected="selected"></option>');
		}
		if (!options.length && !this.$input.attr('multiple')) {
			options.push('<option value="" selected="selected"></option>');
		}
		this.$input.html(options.join(''));
	} else {
		this.$input.val(this.getValue());
	}

	this.$input.trigger('change');
	if (this.isSetup) {
		this.trigger('change', this.$input.val());
	}
};

/**
 * Shows/hide the input placeholder depending
 * on if there items in the list already.
 */
Selectize.prototype.updatePlaceholder = function() {
	if (!this.settings.placeholder) return;
	var $input = this.$control_input;

	if (this.items.length) {
		$input.removeAttr('placeholder');
	} else {
		$input.attr('placeholder', this.settings.placeholder);
	}
	$input.triggerHandler('update');
};

/**
 * Shows the autocomplete dropdown containing
 * the available options.
 */
Selectize.prototype.open = function() {
	if (this.isLocked || this.isOpen || (this.settings.mode === 'multi' && this.isFull())) return;
	this.focus();
	this.isOpen = true;
	this.$dropdown.css({visibility: 'hidden', display: 'block'});
	this.$control.addClass('dropdown-active');
	this.positionDropdown();
	this.$dropdown.css({visibility: 'visible'});
	this.trigger('dropdown_open', this.$dropdown);
};

/**
 * Closes the autocomplete dropdown menu.
 */
Selectize.prototype.close = function() {
	if (!this.isOpen) return;
	this.$dropdown.hide();
	this.$control.removeClass('dropdown-active');
	this.setActiveOption(null);
	this.isOpen = false;
	this.trigger('dropdown_close', this.$dropdown);
};

/**
 * Calculates and applies the appropriate
 * position of the dropdown.
 */
Selectize.prototype.positionDropdown = function() {
	var $control = this.$control;
	var offset = $control.position();
	offset.top += $control.outerHeight(true);

	this.$dropdown.css({
		width : $control.outerWidth(),
		top   : offset.top,
		left  : offset.left
	});
};

/**
 * Resets / clears all selected items
 * from the control.
 */
Selectize.prototype.clear = function() {
	if (!this.items.length) return;
	this.$control.children(':not(input)').remove();
	this.items = [];
	this.setCaret(0);
	this.updatePlaceholder();
	this.updateOriginalInput();
	this.refreshClasses();
	this.showInput();
	this.trigger('clear');
};

/**
 * A helper method for inserting an element
 * at the current caret position.
 *
 * @param {object} $el
 */
Selectize.prototype.insertAtCaret = function($el) {
	var caret = Math.min(this.caretPos, this.items.length);
	if (caret === 0) {
		this.$control.prepend($el);
	} else {
		$(this.$control[0].childNodes[caret]).before($el);
	}
	this.setCaret(caret + 1);
};

/**
 * Removes the current selected item(s).
 *
 * @param {object} e (optional)
 * @returns {boolean}
 */
Selectize.prototype.deleteSelection = function(e) {
	var i, n, direction, selection, values, caret, $tail;

	direction = (e && e.keyCode === KEY_BACKSPACE) ? -1 : 1;
	selection = getSelection(this.$control_input[0]);

	// determine items that will be removed
	values = [];

	if (this.$activeItems.length) {
		$tail = this.$control.children('.active:' + (direction > 0 ? 'last' : 'first'));
		caret = this.$control.children(':not(input)').index($tail);
		if (direction > 0) { caret++; }

		for (i = 0, n = this.$activeItems.length; i < n; i++) {
			values.push($(this.$activeItems[i]).attr('data-value'));
		}
		if (e) {
			e.preventDefault();
			e.stopPropagation();
		}
	} else if ((this.isFocused || this.settings.mode === 'single') && this.items.length) {
		if (direction < 0 && selection.start === 0 && selection.length === 0) {
			values.push(this.items[this.caretPos - 1]);
		} else if (direction > 0 && selection.start === this.$control_input.val().length) {
			values.push(this.items[this.caretPos]);
		}
	}

	// allow the callback to abort
	if (!values.length || (typeof this.settings.onDelete === 'function' && this.settings.onDelete(values) === false)) {
		return false;
	}

	// perform removal
	if (typeof caret !== 'undefined') {
		this.setCaret(caret);
	}
	while (values.length) {
		this.removeItem(values.pop());
	}

	this.showInput();
	this.refreshOptions(true);
	return true;
};

/**
 * Selects the previous / next item (depending
 * on the `direction` argument).
 *
 * > 0 - right
 * < 0 - left
 *
 * @param {int} direction
 * @param {object} e (optional)
 */
Selectize.prototype.advanceSelection = function(direction, e) {
	var tail, selection, idx, valueLength, cursorAtEdge, $tail;

	if (direction === 0) return;

	tail = direction > 0 ? 'last' : 'first';
	selection = getSelection(this.$control_input[0]);

	if (this.isInputFocused && !this.isInputHidden) {
		valueLength = this.$control_input.val().length;
		cursorAtEdge = direction < 0
			? selection.start === 0 && selection.length === 0
			: selection.start === valueLength;

		if (cursorAtEdge && !valueLength) {
			this.advanceCaret(direction, e);
		}
	} else {
		$tail = this.$control.children('.active:' + tail);
		if ($tail.length) {
			idx = this.$control.children(':not(input)').index($tail);
			this.setActiveItem(null);
			this.setCaret(direction > 0 ? idx + 1 : idx);
			this.showInput();
		}
	}
};

/**
 * Moves the caret left / right.
 *
 * @param {int} direction
 * @param {object} e (optional)
 */
Selectize.prototype.advanceCaret = function(direction, e) {
	if (direction === 0) return;
	var fn = direction > 0 ? 'next' : 'prev';
	if (this.isShiftDown) {
		var $adj = this.$control_input[fn]();
		if ($adj.length) {
			this.hideInput();
			this.setActiveItem($adj);
			e && e.preventDefault();
		}
	} else {
		this.setCaret(this.caretPos + direction);
	}
};

/**
 * Moves the caret to the specified index.
 *
 * @param {int} i
 */
Selectize.prototype.setCaret = function(i) {
	if (this.settings.mode === 'single') {
		i = this.items.length;
	} else {
		i = Math.max(0, Math.min(this.items.length, i));
	}

	// the input must be moved by leaving it in place and moving the
	// siblings, due to the fact that focus cannot be restored once lost
	// on mobile webkit devices
	var j, n, fn, $children, $child;
	$children = this.$control.children(':not(input)');
	for (j = 0, n = $children.length; j < n; j++) {
		$child = $($children[j]).detach();
		if (j <  i) {
			this.$control_input.before($child);
		} else {
			this.$control.append($child);
		}
	}

	this.caretPos = i;
};

/**
 * Disables user input on the control. Used while
 * items are being asynchronously created.
 */
Selectize.prototype.lock = function() {
	this.close();
	this.isLocked = true;
	this.refreshClasses();
};

/**
 * Re-enables user input on the control.
 */
Selectize.prototype.unlock = function() {
	this.isLocked = false;
	this.refreshClasses();
};

/**
 * Disables user input on the control completely.
 * While disabled, it cannot receive focus.
 */
Selectize.prototype.disable = function() {
	this.isDisabled = true;
	this.lock();
};

/**
 * Enables the control so that it can respond
 * to focus and user input.
 */
Selectize.prototype.enable = function() {
	this.isDisabled = false;
	this.unlock();
};

/**
 * A helper method for rendering "item" and
 * "option" templates, given the data.
 *
 * @param {string} templateName
 * @param {object} data
 * @returns {string}
 */
Selectize.prototype.render = function(templateName, data) {
	var value, id, label;
	var html = '';
	var cache = false;
	var regex_tag = /^[\t ]*<([a-z][a-z0-9\-_]*(?:\:[a-z][a-z0-9\-_]*)?)/i;

	if (templateName === 'option' || templateName === 'item') {
		value = data[this.settings.valueField];
		cache = isset(value);
	}

	// pull markup from cache if it exists
	if (cache) {
		if (!isset(this.renderCache[templateName])) {
			this.renderCache[templateName] = {};
		}
		if (this.renderCache[templateName].hasOwnProperty(value)) {
			return this.renderCache[templateName][value];
		}
	}

	// render markup
	if (this.settings.render && typeof this.settings.render[templateName] === 'function') {
		html = this.settings.render[templateName].apply(this, [data]);
	} else {
		label = data[this.settings.labelField];
		switch (templateName) {
			case 'optgroup':
				html = '<div class="optgroup">' + data.html + "</div>";
				break;
			case 'optgroup_header':
				label = data[this.settings.optgroupLabelField];
				html = '<div class="optgroup-header">' + label + '</div>';
				break;
			case 'option':
				html = '<div class="option">' + label + '</div>';
				break;
			case 'item':
				html = '<div class="item">' + label + '</div>';
				break;
			case 'option_create':
				html = '<div class="create">Create <strong>' + htmlEntities(data.input) + '</strong>&hellip;</div>';
				break;
		}
	}

	// add mandatory attributes
	if (templateName === 'option' || templateName === 'option_create') {
		html = html.replace(regex_tag, '<$1 data-selectable');
	}
	if (templateName === 'optgroup') {
		id = data[this.settings.optgroupValueField] || '';
		html = html.replace(regex_tag, '<$1 data-group="' + htmlEntities(id) + '"');
	}
	if (templateName === 'option' || templateName === 'item') {
		html = html.replace(regex_tag, '<$1 data-value="' + htmlEntities(value || '') + '"');
	}

	// update cache
	if (cache) {
		this.renderCache[templateName][value] = html;
	}

	return html;
};

Selectize.defaults = {
	plugins: [],
	delimiter: ',',
	persist: true,
	diacritics: true,
	create: false,
	highlight: true,
	openOnFocus: true,
	maxOptions: 1000,
	maxItems: null,
	hideSelected: null,
	preload: false,

	scrollDuration: 60,
	loadThrottle: 300,

	dataAttr: 'data-data',
	optgroupField: 'optgroup',
	sortField: null,
	sortDirection: 'asc',
	valueField: 'value',
	labelField: 'text',
	optgroupLabelField: 'label',
	optgroupValueField: 'value',
	optgroupOrder: null,
	searchField: ['text'],

	mode: null,
	theme: 'default',
	wrapperClass: 'selectize-control',
	inputClass: 'selectize-input',
	dropdownClass: 'selectize-dropdown',
	dropdownContentClass: 'selectize-dropdown-content',

	load            : null, // function(query, callback)
	score           : null, // function(search)
	onChange        : null, // function(value)
	onItemAdd       : null, // function(value, $item) { ... }
	onItemRemove    : null, // function(value) { ... }
	onClear         : null, // function() { ... }
	onOptionAdd     : null, // function(value, data) { ... }
	onOptionRemove  : null, // function(value) { ... }
	onOptionClear   : null, // function() { ... }
	onDropdownOpen  : null, // function($dropdown) { ... }
	onDropdownClose : null, // function($dropdown) { ... }
	onType          : null, // function(str) { ... }
	onDelete        : null, // function(values) { ... }

	render: {
		item: null,
		optgroup: null,
		optgroup_header: null,
		option: null,
		option_create: null
	}
};