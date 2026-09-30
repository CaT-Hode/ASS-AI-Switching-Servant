import React from 'react';
import './conversations.css';
import { ProjectConversations } from './project-conversations.jsx';
export function Conversations({ state, initialHarness, onClient }) {
  return <ProjectConversations state={state} initialHarness={initialHarness} onClient={onClient} />;
}
