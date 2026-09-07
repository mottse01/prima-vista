import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRhythm, completePuzzle, emptyAdventure, loadAdventure, LOCATIONS, pianoRelaySolved, readingLesson, rhythmPattern, roomComplete, roomState, travel, ADVENTURE_KEY } from '../src/core/adventure.js';

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

test('fresh reading unlocks travel only after preparation and rhythm', () => {
  let state=emptyAdventure();
  assert.equal(travel(state),state);
  assert.equal(completePuzzle(state,'music'),state);
  assert.equal(completePuzzle(state,'signal'),state);
  state=completePuzzle(state,'power');
  assert.equal(travel(state),state);
  state=completePuzzle(state,'signal');
  assert.equal(travel(state),state);
  state=completePuzzle(state,'music');
  assert.equal(roomComplete(state),true);
  const next=travel(state);
  assert.equal(next.current,1);
  assert.equal(roomComplete(next,0),true);
  assert.deepEqual(roomState(next),{power:false,signal:false,music:false});
});

test('all destinations have an ending and every reading level has concrete guidance', () => {
  let state=emptyAdventure();
  for(let i=0;i<LOCATIONS.length;i++){
    assert.equal(state.current,i);
    for(const step of ['power','signal','music'])state=completePuzzle(state,step);
    assert.ok(readingLesson(i+1).advice.length>50);
    assert.ok(readingLesson(i+1).task.length>40);
    state=travel(state);
  }
  assert.equal(state.current,9);
  assert.equal(travel(state),state);
});

test('only a valid fresh independent performance can complete the reading challenge', () => {
  const read={score:70,fresh:true,assisted:false,takeIndex:1,curtain:'off'};
  assert.equal(pianoRelaySolved(read),true);
  for(const patch of [{score:69},{fresh:false},{assisted:true},{takeIndex:2},{curtain:'bar'},{valid:false},{unscored:true},{assessmentEligible:false}]){
    assert.equal(pianoRelaySolved({...read,...patch}),false);
  }
  assert.equal(pianoRelaySolved({score:100}),false);
});

test('legacy circuit completion never becomes reading evidence, while visited places are retained', () => {
  const original=globalThis.localStorage;
  globalThis.localStorage={getItem:key=>key===ADVENTURE_KEY?JSON.stringify({version:1,current:3,rooms:{0:{power:true,signal:true,music:true},3:{power:true,signal:true,music:false}}}):null};
  try { const migrated=loadAdventure();assert.equal(migrated.version,2);assert.equal(migrated.current,3);assert.equal(roomComplete(migrated,0),true);assert.deepEqual(roomState(migrated),{power:false,signal:false,music:false}); }
  finally {if(original===undefined)delete globalThis.localStorage;else globalThis.localStorage=original;}
});
