import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/inter/wght.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/header.css';
import './styles/sections.css';
import './styles/assemble.css';
import './styles/case.css';
import { initHeader } from './header';
import { initHero } from './hero/hero';
import { initAssemble } from './assemble';
import { initCase } from './case/case';

initHeader();
initHero();
initCase(initAssemble());
