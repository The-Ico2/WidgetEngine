// Script.js

root = document.querySelector('#widget-container')
Utils.loadDOMWidgets(root).then(() => {
    watchWidgets();
})