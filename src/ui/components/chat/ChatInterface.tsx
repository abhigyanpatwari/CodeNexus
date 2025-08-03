import React, { useState, useRef, useEffect } from 'react';
import type { KnowledgeGraph } from '../../../core/graph/types.ts';
import { LLMService, type LLMProvider, type LLMConfig } from '../../../ai/llm-service.ts';
import { CypherGenerator } from '../../../ai/cypher-generator.ts';
import { RAGOrchestrator, type RAGResponse, type RAGOptions } from '../../../ai/orchestrator.ts';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: {
    cypherQueries?: Array<{ cypher: string; explanation: string }>;
    sources?: string[];
    confidence?: number;
    reasoning?: Array<{ step: number; thought: string; action: string }>;
  };
}

interface ChatInterfaceProps {
  graph: KnowledgeGraph;
  fileContents: Map<string, string>;
  className?: string;
  style?: React.CSSProperties;
}

interface LLMSettings {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  // Azure OpenAI specific fields
  azureOpenAIEndpoint?: string;
  azureOpenAIDeploymentName?: string;
  azureOpenAIApiVersion?: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  graph,
  fileContents,
  className = '',
  style = {}
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  
  // LLM Configuration
  const [llmSettings, setLLMSettings] = useState<LLMSettings>({
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.1,
    maxTokens: 4000,
    azureOpenAIEndpoint: '',
    azureOpenAIDeploymentName: '',
    azureOpenAIApiVersion: '2024-02-01'
  });

  // Services
  const [llmService] = useState(new LLMService());
  const [cypherGenerator] = useState(new CypherGenerator(llmService));
  const [ragOrchestrator] = useState(new RAGOrchestrator(llmService, cypherGenerator));

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Initialize RAG context when graph or fileContents change
  useEffect(() => {
    ragOrchestrator.setContext({ graph, fileContents });
  }, [graph, fileContents, ragOrchestrator]);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedProvider = localStorage.getItem('llm_provider') as LLMProvider;
    const savedApiKey = localStorage.getItem('llm_api_key');
    const savedAzureEndpoint = localStorage.getItem('azure_openai_endpoint');
    const savedAzureDeployment = localStorage.getItem('azure_openai_deployment');
    const savedAzureApiVersion = localStorage.getItem('azure_openai_api_version');

    if (savedProvider || savedApiKey || savedAzureEndpoint) {
      setLLMSettings(prev => ({
        ...prev,
        provider: savedProvider || prev.provider,
        apiKey: savedApiKey || prev.apiKey,
        azureOpenAIEndpoint: savedAzureEndpoint || prev.azureOpenAIEndpoint,
        azureOpenAIDeploymentName: savedAzureDeployment || prev.azureOpenAIDeploymentName,
        azureOpenAIApiVersion: savedAzureApiVersion || prev.azureOpenAIApiVersion,
        // For Azure OpenAI, use deployment name as model, otherwise use default model
        model: savedProvider === 'azure-openai' 
          ? (savedAzureDeployment || 'gpt-4.1-mini-v2')
          : (savedProvider ? llmService.getAvailableModels(savedProvider)[0] : prev.model)
      }));
    }
  }, [llmService]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    // Validate API key
    if (!llmSettings.apiKey.trim()) {
      alert('Please configure your API key in settings');
      setShowSettings(true);
      return;
    }

    if (!llmService.validateApiKey(llmSettings.provider, llmSettings.apiKey)) {
      alert('Invalid API key format. Please check your settings.');
      setShowSettings(true);
      return;
    }

    // Additional validation for Azure OpenAI
    if (llmSettings.provider === 'azure-openai') {
      if (!llmSettings.azureOpenAIEndpoint?.trim()) {
        alert('Please configure your Azure OpenAI endpoint in settings');
        setShowSettings(true);
        return;
      }
      if (!llmSettings.azureOpenAIDeploymentName?.trim()) {
        alert('Please configure your Azure OpenAI deployment name in settings');
        setShowSettings(true);
        return;
      }
    }

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const llmConfig: LLMConfig = {
        provider: llmSettings.provider,
        apiKey: llmSettings.apiKey,
        model: llmSettings.model,
        temperature: llmSettings.temperature,
        maxTokens: llmSettings.maxTokens,
        // Azure OpenAI specific fields
        azureOpenAIEndpoint: llmSettings.azureOpenAIEndpoint,
        azureOpenAIDeploymentName: llmSettings.azureOpenAIDeploymentName,
        azureOpenAIApiVersion: llmSettings.azureOpenAIApiVersion
      };

      const ragOptions: RAGOptions = {
        maxReasoningSteps: 5,
        includeReasoning: showReasoning,
        strictMode: false,
        temperature: llmSettings.temperature
      };

      const response: RAGResponse = await ragOrchestrator.answerQuestion(
        userMessage.content,
        llmConfig,
        ragOptions
      );

      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: response.answer,
        timestamp: new Date(),
        metadata: {
          cypherQueries: response.cypherQueries.map(q => ({
            cypher: q.cypher,
            explanation: q.explanation
          })),
          sources: response.sources,
          confidence: response.confidence,
          reasoning: showReasoning ? response.reasoning.map(r => ({
            step: r.step,
            thought: r.thought,
            action: r.action
          })) : undefined
        }
      };

      setMessages(prev => [...prev, assistantMessage]);

    } catch (error) {
      const errorMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `I apologize, but I encountered an error while processing your question: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle key press in textarea
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  // Clear conversation
  const clearConversation = () => {
    setMessages([]);
  };

  // Generate unique ID
  const generateId = () => {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  // Get available models for current provider
  const getAvailableModels = () => {
    return llmService.getAvailableModels(llmSettings.provider);
  };

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '600px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    backgroundColor: '#fff',
    ...style
  };

  const headerStyle: React.CSSProperties = {
    padding: '16px',
    borderBottom: '1px solid #eee',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px 8px 0 0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  };

  const messagesStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  };

  const inputAreaStyle: React.CSSProperties = {
    padding: '16px',
    borderTop: '1px solid #eee'
  };

  const messageStyle = (role: 'user' | 'assistant'): React.CSSProperties => ({
    padding: '12px 16px',
    borderRadius: '12px',
    maxWidth: '80%',
    alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
    backgroundColor: role === 'user' ? '#007bff' : '#f1f3f4',
    color: role === 'user' ? '#fff' : '#333',
    wordWrap: 'break-word'
  });

  const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: '#007bff',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px'
  };

  const textareaStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '60px',
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    resize: 'vertical',
    fontSize: '14px',
    fontFamily: 'inherit'
  };

  return (
    <div className={`chat-interface ${className}`} style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '18px', fontWeight: '600' }}>💬</span>
          <span style={{ fontSize: '16px', fontWeight: '600' }}>Code Assistant</span>
          <span style={{ 
            fontSize: '12px', 
            color: '#666',
            backgroundColor: '#e9ecef',
            padding: '2px 8px',
            borderRadius: '12px'
          }}>
            {llmService.getProviderDisplayName(llmSettings.provider)}
          </span>
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            style={{
              ...buttonStyle,
              backgroundColor: showReasoning ? '#28a745' : '#6c757d',
              fontSize: '12px',
              padding: '6px 12px'
            }}
            title="Toggle reasoning display"
          >
            🧠 Reasoning
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{ ...buttonStyle, fontSize: '12px', padding: '6px 12px' }}
            title="Settings"
          >
            ⚙️
          </button>
          <button
            onClick={clearConversation}
            style={{
              ...buttonStyle,
              backgroundColor: '#dc3545',
              fontSize: '12px',
              padding: '6px 12px'
            }}
            title="Clear conversation"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div style={{
          padding: '16px',
          backgroundColor: '#f8f9fa',
          borderBottom: '1px solid #eee'
        }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>LLM Configuration</h4>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#666' }}>Provider</label>
              <select
                value={llmSettings.provider}
                onChange={(e) => setLLMSettings(prev => ({
                  ...prev,
                  provider: e.target.value as LLMProvider,
                  model: llmService.getAvailableModels(e.target.value as LLMProvider)[0]
                }))}
                style={{ width: '100%', padding: '6px', fontSize: '14px' }}
              >
                <option value="openai">OpenAI</option>
                <option value="azure-openai">Azure OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
              </select>
            </div>
            
            <div>
              <label style={{ fontSize: '12px', color: '#666' }}>
                {llmSettings.provider === 'azure-openai' ? 'Deployment Name' : 'Model'}
              </label>
              {llmSettings.provider === 'azure-openai' ? (
                <input
                  type="text"
                  value={llmSettings.model}
                  onChange={(e) => setLLMSettings(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="gpt-4.1-mini-v2"
                  style={{ width: '100%', padding: '6px', fontSize: '14px' }}
                />
              ) : (
                <select
                  value={llmSettings.model}
                  onChange={(e) => setLLMSettings(prev => ({ ...prev, model: e.target.value }))}
                  style={{ width: '100%', padding: '6px', fontSize: '14px' }}
                >
                  {getAvailableModels().map(model => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px', color: '#666' }}>API Key</label>
            <input
              type="password"
              value={llmSettings.apiKey}
              onChange={(e) => setLLMSettings(prev => ({ ...prev, apiKey: e.target.value }))}
              placeholder={
                llmSettings.provider === 'azure-openai' ? 'Your Azure OpenAI key...' :
                llmSettings.provider === 'anthropic' ? 'sk-ant-...' :
                llmSettings.provider === 'gemini' ? 'Your Google API key...' : 'sk-...'
              }
              style={{ width: '100%', padding: '6px', fontSize: '14px' }}
            />
          </div>

          {/* Azure OpenAI Specific Fields */}
          {llmSettings.provider === 'azure-openai' && (
            <>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '12px', color: '#666' }}>Azure OpenAI Endpoint</label>
                <input
                  type="text"
                  value={llmSettings.azureOpenAIEndpoint || ''}
                  onChange={(e) => setLLMSettings(prev => ({ ...prev, azureOpenAIEndpoint: e.target.value }))}
                  placeholder="https://your-resource.openai.azure.com"
                  style={{ width: '100%', padding: '6px', fontSize: '14px' }}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '12px', color: '#666' }}>API Version</label>
                <input
                  type="text"
                  value={llmSettings.azureOpenAIApiVersion || '2024-02-01'}
                  onChange={(e) => setLLMSettings(prev => ({ ...prev, azureOpenAIApiVersion: e.target.value }))}
                  placeholder="2024-02-01"
                  style={{ width: '100%', padding: '6px', fontSize: '14px' }}
                />
              </div>
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#666' }}>
                Temperature: {llmSettings.temperature}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={llmSettings.temperature}
                onChange={(e) => setLLMSettings(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                style={{ width: '100%' }}
              />
            </div>
            
            <div>
              <label style={{ fontSize: '12px', color: '#666' }}>Max Tokens</label>
              <input
                type="number"
                min="100"
                max="8000"
                step="100"
                value={llmSettings.maxTokens}
                onChange={(e) => setLLMSettings(prev => ({ ...prev, maxTokens: parseInt(e.target.value) }))}
                style={{ width: '100%', padding: '6px', fontSize: '14px' }}
              />
            </div>
          </div>

          {/* Save Button */}
          <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              onClick={() => {
                // Save to localStorage
                localStorage.setItem('llm_provider', llmSettings.provider);
                localStorage.setItem('llm_api_key', llmSettings.apiKey);
                if (llmSettings.azureOpenAIEndpoint) {
                  localStorage.setItem('azure_openai_endpoint', llmSettings.azureOpenAIEndpoint);
                }
                // For Azure OpenAI, the model field contains the deployment name
                if (llmSettings.provider === 'azure-openai' && llmSettings.model) {
                  localStorage.setItem('azure_openai_deployment', llmSettings.model);
                }
                if (llmSettings.azureOpenAIApiVersion) {
                  localStorage.setItem('azure_openai_api_version', llmSettings.azureOpenAIApiVersion);
                }
                setShowSettings(false);
                alert('Settings saved successfully!');
              }}
              style={{
                ...buttonStyle,
                backgroundColor: '#28a745',
                fontSize: '12px',
                padding: '8px 16px'
              }}
            >
              💾 Save Settings
            </button>
            <button
              onClick={() => setShowSettings(false)}
              style={{
                ...buttonStyle,
                backgroundColor: '#6c757d',
                fontSize: '12px',
                padding: '8px 16px'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={messagesStyle}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: '#666',
            fontSize: '14px',
            padding: '40px 20px'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.3 }}>💬</div>
            <div>Ask me anything about the codebase!</div>
            <div style={{ fontSize: '12px', marginTop: '8px', color: '#999' }}>
              I can help you understand functions, classes, dependencies, and more.
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id}>
            <div style={messageStyle(message.role)}>
              <div style={{ marginBottom: message.metadata ? '8px' : '0' }}>
                {message.content}
              </div>
              
              {/* Metadata */}
              {message.metadata && (
                <div style={{ fontSize: '12px', opacity: 0.8 }}>
                  {message.metadata.confidence && (
                    <div style={{ marginBottom: '4px' }}>
                      Confidence: {Math.round(message.metadata.confidence * 100)}%
                    </div>
                  )}
                  
                  {message.metadata.sources && message.metadata.sources.length > 0 && (
                    <div style={{ marginBottom: '4px' }}>
                      Sources: {message.metadata.sources.join(', ')}
                    </div>
                  )}
                  
                  {message.metadata.cypherQueries && message.metadata.cypherQueries.length > 0 && (
                    <details style={{ marginTop: '8px' }}>
                      <summary style={{ cursor: 'pointer' }}>View Queries ({message.metadata.cypherQueries.length})</summary>
                      {message.metadata.cypherQueries.map((query, index) => (
                        <div key={index} style={{ 
                          marginTop: '4px', 
                          padding: '8px', 
                          backgroundColor: 'rgba(0,0,0,0.1)', 
                          borderRadius: '4px',
                          fontFamily: 'monospace',
                          fontSize: '11px'
                        }}>
                          <div><strong>Query:</strong> {query.cypher}</div>
                          <div><strong>Explanation:</strong> {query.explanation}</div>
                        </div>
                      ))}
                    </details>
                  )}

                  {message.metadata.reasoning && message.metadata.reasoning.length > 0 && (
                    <details style={{ marginTop: '8px' }}>
                      <summary style={{ cursor: 'pointer' }}>View Reasoning ({message.metadata.reasoning.length} steps)</summary>
                      {message.metadata.reasoning.map((step, index) => (
                        <div key={index} style={{ 
                          marginTop: '4px', 
                          padding: '8px', 
                          backgroundColor: 'rgba(0,0,0,0.1)', 
                          borderRadius: '4px',
                          fontSize: '11px'
                        }}>
                          <div><strong>Step {step.step}:</strong> {step.thought}</div>
                          <div><strong>Action:</strong> {step.action}</div>
                        </div>
                      ))}
                    </details>
                  )}
                </div>
              )}
            </div>
            
            <div style={{
              fontSize: '11px',
              color: '#999',
              textAlign: message.role === 'user' ? 'right' : 'left',
              marginTop: '4px'
            }}>
              {message.timestamp.toLocaleTimeString()}
            </div>
          </div>
        ))}

        {isLoading && (
          <div style={messageStyle('assistant')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ 
                width: '16px', 
                height: '16px', 
                border: '2px solid #ccc',
                borderTop: '2px solid #007bff',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              Thinking...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div style={inputAreaStyle}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px' }}>
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask a question about the code..."
            style={textareaStyle}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !inputValue.trim()}
            style={{
              ...buttonStyle,
              minWidth: '80px',
              opacity: (isLoading || !inputValue.trim()) ? 0.5 : 1
            }}
          >
            {isLoading ? '...' : 'Send'}
          </button>
        </form>
      </div>

      {/* CSS for spinner animation */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default ChatInterface; 
