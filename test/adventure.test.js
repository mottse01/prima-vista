import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRhythm, completePuzzle, emptyAdventure, loadAdventure, locationFor, LOCATIONS, pianoRelaySolved, readingLesson, rhythmPattern, roomComplete, roomState, ADVENTURE_KEY } from '../src/core/adventure.js';

test('each rhythm is two complete bars with a playable onset at each non-rest', () => {
  for (let level=1;level<=10;level++) for(let variant=0;variant<3;variant++) {
    const events=rhythmPattern(level,variant);
    assert.equal(events.reduce((sum,e)=>sum+e.duration,0),8);
    const taps=events.filter(e=>!e.rest).map(e=>e.beat);
    assert.equal(assessRhythm(events,taps,1).passed,true);
    assert.equal(assessRhythm(events,taps,1).score,100);
  }
});

test('rhythm evidence rejects silence, button mashing, rushed playing and attacks on rests', () => {
  const events=rhythmPattern(3,0);
  assert.equal(assessRhythm(events,[],1).passed,false);
  assert.equal(assessRhythm(events,Array.from({length:80},(_,i)=>i/10),1).passed,false);
  assert.equal(assessRhythm(events,events.filter(e=>!e.rest).map(e=>e.beat*.6),1).passed,false);
  const all=events.map(e=>e.beat);
  assert.ok(assessRhythm(events,all,1).extras>0);
  assert.ok(assessRhythm(events,all,1).score<100);
  assert.equal(assessRhythm(events,all,1).passed,false);
});

test('the ritual runs in order, and out of order does nothing', () => {
  let state=emptyAdventure();
  // You cannot isolate a rhythm you have not looked at, and reading a fresh
  // piece is the last thing you do rather than the first.
  assert.equal(completePuzzle(state,1,'music'),state);
  assert.equal(completePuzzle(state,1,'signal'),state);
  state=completePuzzle(state,1,'power');
  assert.equal(roomComplete(state,1),false);
  state=completePuzzle(state,1,'signal');
  assert.equal(roomComplete(state,1),false);
  state=completePuzzle(state,1,'music');
  assert.equal(roomComplete(state,1),true);
  assert.equal(completePuzzle(state,1,'nonsense'),state);
});

test('a room is remembered per level, so a visit picks up where it stopped', () => {
  // There is one position and it is the reading level. Nothing is stored about
  // "where you are" — a level names its own room.
  let state=emptyAdventure();
  assert.equal('current' in state,false);
  for(const step of ['power','signal','music'])state=completePuzzle(state,4,step);
  assert.equal(roomComplete(state,4),true);
  assert.equal(roomComplete(state,5),false);
  assert.deepEqual(roomState(state,5),{power:false,signal:false,music:false});
  // Coming back to level 4 finds it as it was left.
  assert.equal(roomState(state,4).music,true);
});

test('every destination is a level, and every level has concrete guidance', () => {
  assert.equal(LOCATIONS.length,10);
  for(let level=1;level<=LOCATIONS.length;level++){
    assert.equal(locationFor(level),LOCATIONS[level-1]);
    assert.ok(readingLesson(level).advice.length>50);
    assert.ok(readingLesson(level).task.length>40);
  }
  assert.equal(locationFor(0),LOCATIONS[0]);
  assert.equal(locationFor(99),LOCATIONS[LOCATIONS.length-1]);
});

test('only a valid fresh independent performance can complete the reading challenge', () => {
  const read={score:70,fresh:true,assisted:false,takeIndex:1,curtain:'off'};
  assert.equal(pianoRelaySolved(read),true);
  for(const patch of [{score:69},{fresh:false},{assisted:true},{takeIndex:2},{curtain:'bar'},{valid:false},{unscored:true},{assessmentEligible:false}]){
    assert.equal(pianoRelaySolved({...read,...patch}),false);
  }
  assert.equal(pianoRelaySolved({score:100}),false);
});

test('a saved expedition moves onto the level it was always standing in', () => {
  const original=globalThis.localStorage;
  // Rooms were numbered from zero and levels from one, so room 0 is level 1.
  globalThis.localStorage={getItem:key=>key===ADVENTURE_KEY?JSON.stringify({version:2,current:3,rooms:{0:{power:true,signal:true,music:true},3:{power:true,signal:true,music:false}}}):null};
  try {
    const migrated=loadAdventure();
    assert.equal(migrated.version,3);
    assert.equal('current' in migrated,false,'the second position is gone');
    assert.equal(roomComplete(migrated,1),true);
    assert.equal(roomState(migrated,4).signal,true);
    assert.equal(roomState(migrated,4).music,false);
    assert.deepEqual(roomState(migrated,2),{power:false,signal:false,music:false});
  }
  finally {if(original===undefined)delete globalThis.localStorage;else globalThis.localStorage=original;}
});

test('a corrupt or absent save starts a clean expedition', () => {
  const original=globalThis.localStorage;
  for(const stored of [null,'{',JSON.stringify({version:9,rooms:{}}),JSON.stringify({version:3})]){
    globalThis.localStorage={getItem:()=>stored};
    assert.deepEqual(loadAdventure(),emptyAdventure());
  }
  if(original===undefined)delete globalThis.localStorage;else globalThis.localStorage=original;
});
