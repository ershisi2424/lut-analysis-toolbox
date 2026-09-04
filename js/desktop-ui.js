(function () {
  'use strict';

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var trigger = event.target.closest('[data-file-trigger]');
    if (!trigger) return;
    var input = document.getElementById(trigger.getAttribute('data-file-trigger'));
    if (!input) return;
    event.preventDefault();
    input.click();
  });
})();
