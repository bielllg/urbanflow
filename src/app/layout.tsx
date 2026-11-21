import type {Metadata} from 'next';
import localFont from 'next/font/local';
import './globals.css';
import '../components/views.css';

const inter=localFont({src:'./fonts/inter-latin-wght-normal.woff2',weight:'400 800',display:'swap',variable:'--font-inter'});

export const metadata: Metadata = {
  title:'Via Viva · Mobilidade de Belo Horizonte',
  description:'Mapa, trânsito, segurança viária e transporte público de Belo Horizonte com dados abertos.',
};

export default function Layout({children}:{children:React.ReactNode}) {
  return <html lang="pt-BR" className={inter.variable}><body>{children}</body></html>;
}
