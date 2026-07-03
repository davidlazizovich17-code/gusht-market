'use strict';

// Tashqi (USB/dukon) kamerani ichkidan ustun qilib tanlaymiz
async function getBestCameraId() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
    tmp.getTracks().forEach(t => t.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === 'videoinput');
    if (!cameras.length) return null;

    const external = cameras.find(c => {
      const l = c.label.toLowerCase();
      return !l.includes('integrated') && !l.includes('built-in') &&
             !l.includes('facetime')   && !l.includes('front')    &&
             !l.includes('ichki');
    });

    const chosen = external || cameras[cameras.length - 1];
    console.log('Kamera:', chosen.label || chosen.deviceId);
    return chosen.deviceId;
  } catch (e) {
    return null;
  }
}

// Sahifa ochilganda kamera ruxsatini oldindan so'raymiz
async function requestCameraAccess() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach(t => t.stop());
  } catch (e) {
    console.warn('Kamera ruxsati:', e.message);
  }
}

// Qarz yozilganda kamera orqali RASM olib saqlaymiz
async function captureDebtPhoto(customerName) {
  try {
    const deviceId = await getBestCameraId();

    const videoConstraints = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 } };

    const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });

    // Video element orqali kadr olamiz
    const video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    await video.play();

    // Kamera tayyor bo'lishini kutamiz (600ms)
    await new Promise(r => setTimeout(r, 600));

    // Canvas ga chizamiz
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    // Streamni to'xtatamiz
    stream.getTracks().forEach(t => t.stop());

    // JPG sifatida yuklab olamiz
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safe = (customerName || 'mijoz').replace(/[^a-zA-Z0-9А-яЁёa-zA-ZЀ-ӿ]/g, '_');

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.download = `qarz_${safe}_${ts}.jpg`;
      a.href     = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }, 'image/jpeg', 0.92);

  } catch (e) {
    console.warn('Kamera rasm:', e.message);
  }
}

// Eski nom bilan chaqirishlar ham ishlashi uchun alias
const captureDebtVideo = captureDebtPhoto;
