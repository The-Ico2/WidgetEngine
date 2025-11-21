// index.js

const BACKEND_URL = "http://localhost:7000";

root = document.querySelector('#widget-container')
Utils.loadDOMWidgets(root).then(() => {
    watchWidgets();
})