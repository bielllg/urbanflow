'use client';

import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';

type PopupName = 'period'|'city'|'filters'|'layers'|'notifications'|'search';
const controls='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled])';
const mobileWidth='(max-width: 960px)';
const narrowScreen=()=>window.matchMedia(mobileWidth).matches;
const serverScreen=()=>false;
function observeScreen(change:()=>void) {
  const media=window.matchMedia(mobileWidth);
  media.addEventListener('change',change);
  return ()=>media.removeEventListener('change',change);
}

export function useWorkspaceOverlays() {
  const [mobile,setMobile]=useState(false);
  const [popup,setPopup]=useState<PopupName|null>(null);
  const mobileViewport=useSyncExternalStore(observeScreen,narrowScreen,serverScreen);
  const sidebar=useRef<HTMLElement>(null);
  const opener=useRef<HTMLButtonElement>(null);
  const heading=useRef<HTMLHeadingElement>(null);

  const closePopup=useCallback((restoreFocus=false)=>{
    if(restoreFocus && popup) document.getElementById('open-'+popup)?.focus({preventScroll:true});
    setPopup(null);
  },[popup]);

  const closeMobile=useCallback((restoreFocus=true)=>{
    setMobile(false);
    if(restoreFocus) requestAnimationFrame(()=>opener.current?.focus({preventScroll:true}));
  },[]);

  useEffect(()=>{
    if(!popup)return;
    const panel=document.getElementById('panel-'+popup);
    const trigger=document.getElementById('open-'+popup);
    const frame=requestAnimationFrame(()=>{
      (panel?.querySelector<HTMLElement>('[data-initial-focus]') ?? panel)?.focus({preventScroll:true});
    });
    function outside(event:PointerEvent){
      if(event.target instanceof Node && !panel?.contains(event.target) && !trigger?.contains(event.target))closePopup();
    }
    document.addEventListener('pointerdown',outside);
    return ()=>{
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown',outside);
    };
  },[popup,closePopup]);

  useEffect(()=>{
    if(!mobile)return;
    const frame=requestAnimationFrame(()=>sidebar.current?.querySelector<HTMLElement>('[data-close-navigation]')?.focus());
    const media=window.matchMedia(mobileWidth);
    const overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const onResize=()=>{if(!media.matches)closeMobile(false);};
    media.addEventListener('change',onResize);
    return ()=>{
      cancelAnimationFrame(frame);
      document.body.style.overflow=overflow;
      media.removeEventListener('change',onResize);
    };
  },[mobile,closeMobile]);

  useEffect(()=>{
    if(!mobile&&!popup)return;
    function onKey(event:KeyboardEvent){
      if(event.defaultPrevented)return;
      if(event.key==='Escape'){
        event.preventDefault();
        if(mobile)closeMobile();
        else closePopup(true);
      }
      if(!mobile||event.key!=='Tab')return;
      const tabbable=Array.from(sidebar.current?.querySelectorAll<HTMLElement>(controls)??[]).filter(element=>element.getClientRects().length>0&&getComputedStyle(element).visibility==='visible');
      const first=tabbable[0],last=tabbable.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
    document.addEventListener('keydown',onKey);
    return ()=>document.removeEventListener('keydown',onKey);
  },[mobile,popup,closeMobile,closePopup]);

  const toggle=(next:PopupName)=>setPopup(previous=>previous===next?null:next);
  const trigger=(name:PopupName)=>({id:'open-'+name,'aria-expanded':popup===name,'aria-controls':popup===name?'panel-'+name:undefined,onClick:()=>toggle(name)});
  const panel=(name:PopupName)=>({id:'panel-'+name,tabIndex:-1});

  return {mobile,mobileViewport,popup,sidebar,opener,heading,trigger,panel,closePopup,closeMobile,openMobile:()=>{closePopup();setMobile(true);}};
}
