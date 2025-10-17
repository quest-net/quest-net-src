import { useState } from 'react';
import { useQuestContext, triggerContextUpdate } from './ContextProvider';
import { useNavigate } from 'react-router-dom';
import { UserActions } from '../User/UserActions';

export function Home() {
  const context = useQuestContext();
  const navigate = useNavigate();
  const [nameInput, setNameInput] = useState(context.User.Name);

  const handleNameUpdate = () => {
    // Modify the context object using the domain action
    UserActions.setName({ name: nameInput }, context);
    // Persist the changes and trigger a re-render
    triggerContextUpdate();
  };
  
  return (
    <div style={{ padding: '20px' }}>
      <h1>Quest Net</h1>
      <p>Welcome, {context.User.Name}!</p>

      <div style={{ margin: '20px 0' }}>
        <input 
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder="Enter your name"
          aria-label="User name input"
        />
        <button onClick={handleNameUpdate} style={{ marginLeft: '8px' }}>
          Update Name
        </button>
      </div>

      <button onClick={() => navigate('/campaigns')}>
        View Campaigns
      </button>
    </div>
  );
}