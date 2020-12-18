
import XMPlayer from "./models/XMPlayer"

if (!window.XMView) {
  window.XMView = {};
}

const XMView = window.XMView;
if (!window.XMPlayer) {
  console.log("Create new xmplayer")
  window.XMPlayer = new XMPlayer();
}

(function (window, document) {
  var XMPlayer = window.XMPlayer;


  function loadXMAndInit(xmdata) {
    console.log("loadXMAndInit")
    if (!XMPlayer.load(xmdata)) {
      return;
    }

    XMView.init();

    var playbutton: any = document.getElementById("playpause");
    playbutton.innerHTML = 'Play';
    playbutton.onclick = function () {
      if (XMPlayer.playing) {
        XMPlayer.pause();
        playbutton.innerHTML = 'Play';
      } else {
        XMPlayer.play();
        playbutton.innerHTML = 'Pause';
      }
    };
    playbutton.disabled = false;

    return XMPlayer.xm;
  }

  function downloadXM(uri) {
    var xmReq = new XMLHttpRequest();
    xmReq.open("GET", uri, true);
    xmReq.responseType = "arraybuffer";
    xmReq.onload = function (xmEvent) {
      var arrayBuffer = xmReq.response;
      if (arrayBuffer) {
        loadXMAndInit(arrayBuffer);
      } else {
        console.log("unable to load", uri);
      }
    };
    xmReq.send(null);
  }

  XMPlayer.allowDrop = function (ev) {
    ev.stopPropagation();
    ev.preventDefault();
    var elem = document.getElementById("playercontainer");
    elem.className = (ev.type == "dragover" ? "draghover" : "playercontainer");
    return false;
  };

  XMPlayer.handleDrop = function (e) {
    console.log(e);
    e.preventDefault();
    var elem = document.getElementById("playercontainer");
    elem.className = "playercontainer";
    var files = e.target.files || e.dataTransfer.files;
    if (files.length < 1) return false;
    var reader = new FileReader();
    reader.onload = function (e) {
      XMPlayer.stop();
      loadXMAndInit(e.target.result);
    };
    reader.readAsArrayBuffer(files[0]);
    return false;
  };

  function initFilelist() {
    var el = document.getElementById('filelist');
    window.xmuris.forEach(function (entry) {
      var a = document.createElement('a');
      a.text = entry[0];
      a.href = '#' + entry[1];
      a.onclick = function () {
        el.style.display = "none";
        XMPlayer.stop();
        downloadXM(window.baseuri + entry[1]);
      };
      el.appendChild(a);
      el.appendChild(document.createElement('br'));
    });
    var loadbutton = document.getElementById('loadbutton');
    loadbutton.onclick = function () {
      if (el.style.display == "none") {
        el.style.display = "block";
      } else {
        el.style.display = "none";
      }
    };
  }

  window.onload = function () {
    XMPlayer.init();
    initFilelist();

    var uri = location.hash.substr(1);
    if (uri === "") {
      uri = "kamel.xm";
    }
    if (!uri.startsWith("http")) {
      uri = window.baseuri + uri;
    }
    downloadXM(uri);
  };

})(window, document);
