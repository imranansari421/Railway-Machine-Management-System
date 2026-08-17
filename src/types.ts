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
