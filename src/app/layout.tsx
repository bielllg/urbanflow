import type {Metadata} from 'next';
import './globals.css';

export const metadata: Metadata = {
  title:'UrbanFlow · Mobilidade de Belo Horizonte',
  description:'Mapa, trânsito, segurança viária e transporte público de Belo Horizonte com dados abertos.',
};

export default function Layout({children}:{children:React.ReactNode}) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
