'use strict';

let customRatio = true;

// aspect       0      1      2      3       4
let ratios = ['0:0', '4:3', '16:9', '1:1', '1:2'];
let aspect = 2;

let ratio = getAspectRatio();

/**
 * Get aspect ratio
 * @returns {integer} aspect ratio
 */
function getAspectRatio() {
    customRatio = aspect == 0 ? true : false;
    const ratio = ratios[aspect].split(':');
    return ratio[1] / ratio[0];
}

/**
 * Set aspect ratio
 * @param {integer} index ratios index
 */
function setAspectRatio(index) {
    aspect = index;
    ratio = getAspectRatio();
    resizeVideoMedia();
}

/**
 * Calculate area
 * @param {integer} Increment
 * @param {integer} Count
 * @param {integer} Width
 * @param {integer} Height
 * @param {integer} Margin
 * @returns
 */
function Area(Increment, Count, Width, Height, Margin = 10) {
    ratio = customRatio ? 0.75 : ratio;
    let i = 0;
    let w = 0;
    let h = Increment * ratio + Margin * 2;
    while (i < Count) {
        if (w + Increment > Width) {
            w = 0;
            h = h + Increment * ratio + Margin * 2;
        }
        w = w + Increment + Margin * 2;
        i++;
    }
    if (h > Height) return false;
    else return Increment;
}

/**
 * Resize video elements
 */
function resizeVideoMedia() {
    const videoMediaContainer = getId('videoMediaContainer');
    const Cameras = getEcN('Camera');

    const Margin = 5;
    let Width = videoMediaContainer.offsetWidth - Margin * 2;
    let Height = videoMediaContainer.offsetHeight - Margin * 2;
    let max = 0;
    let optional = isHideMeActive && videoMediaContainer.childElementCount <= 2 ? 1 : 0;
    let isOneVideoElement = videoMediaContainer.childElementCount - optional == 1 ? true : false;

    // console.log('videoMediaContainer.childElementCount:', {
    //     isOneVideoElement: isOneVideoElement,
    //     children: videoMediaContainer.childElementCount,
    //     optional: optional,
    // });

    resetZoom(); //...

    let bigWidth = Width * 4;
    if (isOneVideoElement) {
        Width = Width - bigWidth;
    }

    // loop (i recommend you optimize this)
    let i = 1;
    while (i < 5000) {
        let w = Area(i, Cameras.length, Width, Height, Margin);
        if (w === false) {
            max = i - 1;
            break;
        }
        i++;
    }

    max = max - Margin * 2;
    setWidth(Cameras, max, bigWidth, Margin, Height, isOneVideoElement);
    setSP('--vmi-wh', max / 3 + 'px');
}

/**
 * Reset zoom to avoid incorrect UI on screen resize
 */
function resetZoom() {
    const videoElements = getSlALL('video');
    videoElements.forEach((video) => {
        video.style.transform = '';
        video.style.transformOrigin = 'center';
    });
}

/**
 * Set Width
 * @param {object} Cameras
 * @param {integer} width
 * @param {integer} bigWidth
 * @param {integer} margin
 * @param {integer} maxHeight
 * @param {boolean} isOneVideoElement
 */
function setWidth(Cameras, width, bigWidth, margin, maxHeight, isOneVideoElement) {
    ratio = customRatio ? 0.68 : ratio;
    for (let s = 0; s < Cameras.length; s++) {
        Cameras[s].style.width = width + 'px';
        Cameras[s].style.margin = margin + 'px';
        Cameras[s].style.height = width * ratio + 'px';
        if (isOneVideoElement) {
            Cameras[s].style.width = bigWidth + 'px';
            Cameras[s].style.height = bigWidth * ratio + 'px';
            let camHeigh = Cameras[s].style.height.substring(0, Cameras[s].style.height.length - 2);
            if (camHeigh >= maxHeight) Cameras[s].style.height = maxHeight - 2 + 'px';
        }
    }
}

/**
 * Handle window event listener
 */
window.addEventListener(
    'load',
    function (event) {
        resizeVideoMedia();
        window.onresize = resizeVideoMedia;
    },
    false,
);
