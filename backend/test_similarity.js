import { calculateBehaviorScore } from './src/services/behavior.service.js';

const profile = {
  averageHoldTime: 120,
  averageFlightTime: 70,
  typingSpeed: 45,
  backspaceCount: 2,
  errorCount: 1,
  typingDuration: 18.0
};

const session1 = {
  averageHoldTime: 112,
  averageFlightTime: 68,
  typingSpeed: 46,
  backspaceCount: 2,
  errorCount: 1,
  typingDuration: 18.4
};

const session2 = {
  averageHoldTime: 250, // very slow hold time
  averageFlightTime: 200, // very long flight time
  typingSpeed: 15, // slow speed
  backspaceCount: 10, // high error correction
  errorCount: 8, // high errors
  typingDuration: 45.0 // high duration
};

console.log('Testing Similarity Calculations:');
console.log('=================================');
console.log('Profile Baseline:', profile);
console.log('---------------------------------');

const res1 = calculateBehaviorScore(session1, profile);
console.log('Matching Session Features:', session1);
console.log('Behavior Score:', res1.behaviorScore);
console.log('Status Decision:', res1.status);
console.log('Breakdown:', res1.similarities);
console.log('---------------------------------');

const res2 = calculateBehaviorScore(session2, profile);
console.log('Non-Matching Session Features:', session2);
console.log('Behavior Score:', res2.behaviorScore);
console.log('Status Decision:', res2.status);
console.log('Breakdown:', res2.similarities);
console.log('=================================');

if (res1.behaviorScore >= 80 && res1.status === 'MATCH' && res2.behaviorScore < 80 && res2.status === 'MISMATCH') {
  console.log('SUCCESS: Similarity math verified correctly!');
} else {
  console.error('FAILURE: Metrics outside of threshold range!');
}
