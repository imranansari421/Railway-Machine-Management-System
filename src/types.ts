export interface Reply {
  sender: 'employee' | 'admin';
  senderName: string;
  text: string;
  imageUrl?: string;
  createdAt: string;
}

export interface SupportMessage {
  id: string;
  employeeId: string;
  name: string;
  pfNo: string;
  email: string;
  mobile: string;
  designation: string;
  message: string;
  imageUrl?: string;
  status: 'open' | 'responded' | 'closed';
  createdAt: string;
  replies: Reply[];
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      marquee: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        behavior?: string;
        direction?: string;
        scrollamount?: string | number;
        scrolldelay?: string | number;
        loop?: string | number;
      };
    }
  }
}

