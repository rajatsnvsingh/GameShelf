/** Mounts the GameShelf renderer application into the document root. */
import { mount } from 'svelte';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
