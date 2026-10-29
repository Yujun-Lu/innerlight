/* Public showcase: fictional source samples only. No API, microphone, or personal input. */
(() => {
  const audio = document.getElementById('sample-audio');
  const status = document.getElementById('audio-status');
  const buttons = Array.from(document.querySelectorAll('[data-sample]'));
  let samples;
  let selected = 'giving';
  const text = (id, value) => { document.getElementById(id).textContent = value; };
  const renderScript = (script) => {
    const target = document.getElementById('sample-script');
    target.replaceChildren(...script.split('\n\n').map(paragraph => {
      const p = document.createElement('p'); p.textContent = paragraph; return p;
    }));
  };
  const choose = (id) => {
    if (!samples || !samples[id]) return;
    const sample = samples[id];
    selected = id;
    audio.pause();
    audio.src = `assets/audio/${id}.wav`;
    audio.setAttribute('aria-label', `Play the fictional ${sample.label} sample narration`);
    status.textContent = '';
    text('sample-words', `“${sample.text}”`);
    text('sample-feeling', sample.reflection.feeling);
    text('sample-need', sample.reflection.need);
    text('sample-title', sample.meditation.title);
    text('sample-affirmation', sample.meditation.affirmation);
    renderScript(sample.meditation.script);
    document.querySelector('.sample-player details').open = false;
    buttons.forEach(button => {
      const active = button.dataset.sample === id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };
  buttons.forEach(button => button.addEventListener('click', () => {
    if (samples) choose(button.dataset.sample);
    else status.textContent = 'The sample list is still loading. You can listen to the first sample above.';
  }));
  audio.addEventListener('error', () => {
    status.textContent = 'Audio could not be loaded. Please try again, or read the narration below.';
  });
  audio.addEventListener('playing', () => { status.textContent = ''; });
  fetch('samples.json').then(response => {
    if (!response.ok) throw new Error('Sample content unavailable');
    return response.json();
  }).then(data => {
    samples = data;
    renderScript(samples[selected].meditation.script);
  }).catch(() => {
    status.textContent = 'The sample list could not be loaded. The first audio sample remains available.';
    buttons.filter(button => button.dataset.sample !== 'giving').forEach(button => { button.disabled = true; });
  });
})();
