// Web MIDI input. Falls back silently when the browser or device is absent —
// the on-screen keyboard and mic-free visual mode still work.

export function midiSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
}

/**
 * @param {(e: {type:'on'|'off', midi:number, velocity:number, time:number}) => void} onEvent
 * @param {(inputs: string[]) => void} onInputs
 */
export async function connectMidi(onEvent, onInputs) {
  if (!midiSupported()) throw new Error('Web MIDI is not available in this browser.');
  const access = await navigator.requestMIDIAccess({ sysex: false });

  const attach = () => {
    const names = [];
    for (const input of access.inputs.values()) {
      names.push(input.name || 'MIDI input');
      input.onmidimessage = (msg) => {
        const [status, note, velocity] = msg.data;
        const cmd = status & 0xf0;
        if (cmd === 0x90 && velocity > 0) {
          onEvent({ type: 'on', midi: note, velocity, time: msg.timeStamp / 1000 });
        } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
          onEvent({ type: 'off', midi: note, velocity: 0, time: msg.timeStamp / 1000 });
        }
      };
    }
    onInputs && onInputs(names);
  };

  attach();
  access.onstatechange = attach;

  return {
    close() {
      for (const input of access.inputs.values()) input.onmidimessage = null;
      access.onstatechange = null;
    },
  };
}
