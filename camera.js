'use strict';

// Tashqi (USB/dukon) kamerani ichkidan ustun qilib tanlaymiz
async function getBestCameraId() {
  try {
    // Avval ruxsat olamiz (qurilmalar ro'yxati uchun)
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    tmp.getTracks().forEach(t => t.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === 'videoinput');

    if (!cameras.length) return null;

    // Tashqi / USB kamerani izlaymiz (ichki kamera odatda "integrated" yoki "built-in" deb ataladi)
    const external = cameras.find(c => {
      const label = c.label.toLowerCase();
      return !label.includes('integrated') &&
             !label.includes('built-in') &&
             !label.includes('facetime') &&
             !label.includes('front') &&
             !label.includes('ichki');
    });

    // Tashqi topilsa — uni, aks holda oxirgi kamerani olamiz (Windows da tashqi USB odatda oxirida)
    const chosen = external || cameras[cameras.length - 1];
    console.log('Tanlangan kamera:', chosen.label || chosen.deviceId);
    return chosen.deviceId;
  } catch (e) {
    console.warn('Kamera ro\'yxati:', e.message);
    return null;
  }
}

// Sahifa ochilganda kamera ruxsatini oldindan so'raymiz
async function requestCameraAccess() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stream.getTracks().forEach(t => t.stop());
  } catch (e) {
    console.warn('Kamera ruxsati berilmadi:', e.message);
  }
}

// Qarz yozilganda kamera orqali 5 soniya yashirin video yozib saqlanadi
async function captureDebtVideo(customerName) {
  try {
    const deviceId = await getBestCameraId();

    const videoConstraints = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 } };

    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: true
    });

    // Qo'llab-quvvatlanadigan formatni topamiz
    const mime = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || '';

    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    const chunks = [];

    recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: mime || 'video/webm' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const safe = (customerName || 'mijoz').replace(/[^\wА-яЁёa-zA-Z0-9]/g, '_');
      const ext  = (mime || '').includes('mp4') ? 'mp4' : 'webm';
      a.download = `qarz_${safe}_${ts}.${ext}`;
      a.href     = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    };

    recorder.start(200);
    setTimeout(() => {
      try { if (recorder.state === 'recording') recorder.stop(); } catch (_) {}
    }, 5000);

  } catch (e) {
    // Kamera yo'q yoki ruxsat berilmagan — jimgina o'tamiz
    console.warn('Kamera yozuvi:', e.message);
  }
}
