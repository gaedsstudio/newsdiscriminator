import { useState } from 'react';
import './App.css';

function extractKeySentences(text) {
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 20);
  
  const scored = sentences.map(sentence => {
    let score = 0;
    if (sentence.match(/\d+/)) score += 2;
    if (sentence.match(/출처|자료|제공|발표|밝혔다|전했다|말했다/)) score += 3;
    if (sentence.match(/그러나|하지만|따라서|결과/)) score += 1;
    if (sentence.length > 50 && sentence.length < 150) score += 1;
    return { sentence, score };
  });
  
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map(s => s.sentence).join('. ') + '.';
}

async function getAISummary(text) {
  try {
    const response = await fetch(
      "https://api-inference.huggingface.co/models/facebook/bart-large-cnn",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: text.slice(0, 1000),
          parameters: {
            max_length: 130,
            min_length: 30
          }
        })
      }
    );
    
    const result = await response.json();
    
    if (result.error) {
      console.error('Hugging Face 에러:', result.error);
      return null;
    }
    
    if (result[0] && result[0].summary_text) {
      const englishSummary = result[0].summary_text;
      const koreanResponse = await fetch(
        "https://api-inference.huggingface.co/models/Helsinki-NLP/opus-mt-en-ko",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inputs: englishSummary
          })
        }
      );
      
      const koreanResult = await koreanResponse.json();
      if (koreanResult[0] && koreanResult[0].translation_text) {
        return koreanResult[0].translation_text;
      }
    }
    
    return null;
  } catch (err) {
    console.error('AI 요약 실패:', err);
    return null;
  }
}

function analyzeTextQuality(text) {
  const features = {
    length: text.length,
    paragraphs: text.split('\n\n').filter(p => p.trim()).length,
    sentences: (text.match(/[.!?]+/g) || []).length,
    clickbaitWords: (text.match(/클릭|충격|논란|대박|놓친|실시간|긴급|속보/gi) || []).length,
    numbers: (text.match(/\d+/g) || []).length,
    quotes: (text.match(/["'`""]/g) || []).length,
    sources: (text.match(/출처|자료|제공|사진|취재|보도|발표|밝혔다|전했다|말했다|설명했다/g) || []).length,
    avgSentenceLength: text.length / Math.max((text.match(/[.!?]+/g) || []).length, 1),
    questions: (text.match(/\?/g) || []).length,
    exclamations: (text.match(/!/g) || []).length,
    conjunctions: (text.match(/그러나|하지만|그리고|또한|따라서/g) || []).length
  };

  let score = 70;
  const issues = [];
  const reasons = [];

  if (features.length < 200) {
    score -= 15;
    issues.push('내용이 너무 짧음');
    reasons.push('기사 길이가 200자 미만으로 충분한 정보를 제공하지 못함');
  } else if (features.length > 500) {
    reasons.push('적절한 기사 길이 유지');
  }

  if (features.clickbaitWords > 3) {
    score -= 20;
    issues.push('낚시성 표현 과다');
    reasons.push(`선정적 단어 ${features.clickbaitWords}개 사용으로 신뢰도 저하`);
  } else if (features.clickbaitWords > 0) {
    score -= 10;
    issues.push('낚시성 표현 포함');
    reasons.push('일부 선정적 표현이 포함되어 있음');
  } else {
    reasons.push('선정적 표현 없이 객관적으로 작성됨');
  }

  if (features.paragraphs < 2) {
    score -= 15;
    issues.push('문단 구조 부실');
    reasons.push('문단 구분이 없어 가독성이 떨어짐');
  } else if (features.paragraphs >= 3) {
    reasons.push('적절한 문단 구성으로 가독성 양호');
  }

  if (features.sentences < 3) {
    score -= 10;
    issues.push('문장 수 부족');
    reasons.push('문장이 너무 적어 충분한 설명 부족');
  }

  if (features.numbers === 0) {
    score -= 5;
    issues.push('구체적 수치 부족');
    reasons.push('통계나 수치 자료가 없어 신뢰성 부족');
  } else if (features.numbers > 2) {
    reasons.push('구체적 수치를 포함하여 신뢰도 향상');
  }

  if (features.exclamations > 3) {
    score -= 10;
    issues.push('과도한 감탄부호 사용');
    reasons.push('감정적 표현이 과도하여 객관성 저하');
  }

  if (features.avgSentenceLength > 200) {
    score -= 10;
    issues.push('문장이 너무 김');
    reasons.push('평균 문장 길이가 너무 길어 이해하기 어려움');
  } else if (features.avgSentenceLength < 30) {
    score -= 5;
    issues.push('문장이 너무 짧음');
    reasons.push('문장이 단순하여 깊이 있는 분석 부족');
  } else {
    reasons.push('적절한 문장 길이로 읽기 편함');
  }

  if (features.conjunctions === 0 && features.sentences > 5) {
    score -= 5;
    issues.push('문장 연결성 부족');
    reasons.push('접속사 부재로 문장 간 논리적 연결 부족');
  }

  if (features.quotes === 0 && features.sources === 0 && features.length > 500) {
    score -= 5;
    issues.push('인용 또는 출처 부재');
    reasons.push('직접 인용이나 출처가 없어 신뢰도 감소');
  } else if (features.quotes > 0 || features.sources > 0) {
    reasons.push('출처 또는 인용구 포함으로 신뢰성 확보');
  }

  const summary = text.slice(0, 150) + (text.length > 150 ? '...' : '');
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    quality: score >= 80 ? '양호' : score >= 60 ? '보통' : '불량',
    issues: issues.length > 0 ? issues : ['특이사항 없음'],
    summary,
    reasons
  };
}

function App() {
  const [articleText, setArticleText] = useState('');
  const [url, setUrl] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchArticle = async (articleUrl) => {
    const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(articleUrl)}`);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    doc.querySelectorAll('script, style, nav, header, footer, aside, iframe').forEach(el => el.remove());
    
    const article = doc.querySelector('article') || doc.querySelector('[role="main"]') || doc.querySelector('main') || doc.body;
    const paragraphs = Array.from(article.querySelectorAll('p'));
    const text = paragraphs.map(p => p.textContent.trim()).filter(t => t.length > 20).join('\n\n');
    
    if (!text || text.length < 50) {
      throw new Error('기사를 찾을 수 없습니다');
    }
    
    return text;
  };

  const analyzeArticle = async (e) => {
    e.preventDefault();
    setError('');
    
    let text = articleText.trim();
    
    if (url.trim() && !text) {
      setLoading(true);
      try {
        text = await fetchArticle(url);
        setArticleText(text);
      } catch (err) {
        setError('URL에서 기사를 가져올 수 없습니다. 내용을 직접 복사해주세요.');
        setLoading(false);
        return;
      }
    }
    
    if (!text) {
      setError('내용을 입력하거나 URL을 입력하세요');
      setLoading(false);
      return;
    }

    setLoading(true);
    
    const analysis = analyzeTextQuality(text);
    const keySummary = extractKeySentences(text);
    
    setResult({
      ...analysis,
      keySummary
    });
    
    setLoading(false);
  };

  return (
    <div className="container">
      <div className="header">
        <h1>기사 품질 분석</h1>
      </div>
      
      <form onSubmit={analyzeArticle}>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="기사 URL (선택)"
        />
        <textarea
          value={articleText}
          onChange={(e) => setArticleText(e.target.value)}
          placeholder="또는 기사 내용을 직접 입력"
          rows="10"
        />
        <button type="submit" disabled={loading}>
          {loading ? '분석 중...' : '분석'}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {result && (
        <div className="result">
          <div className="score">
            <span className="score-value">{result.score}</span>
            <span className="score-label">점</span>
          </div>
          <div className="quality">{result.quality}</div>
          
          <div className="summary-section">
            <h3>주요 문장</h3>
            <p>{result.keySummary}</p>
          </div>
          
          <div className="reasons-section">
            <h3>평가 근거</h3>
            {result.reasons.map((reason, i) => (
              <div key={i} className="reason">{reason}</div>
            ))}
          </div>
          
          <div className="issues">
            <h3>문제점</h3>
            {result.issues.map((issue, i) => (
              <div key={i} className="issue">{issue}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
