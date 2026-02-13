# GitHub 최신 폴더로 업데이트하기

이 프로젝트를 GitHub 저장소의 **최신 버전**으로 맞추려면, **프로젝트 최상위 폴더**에서 아래 명령을 실행하세요.

---

## 1. 터미널에서 프로젝트 폴더로 이동

```bash
cd "c:\Users\백요한\OneDrive\바탕 화면\웹\NotionUIUX-main\NotionUIUX"
```

(또는 Cursor/VS Code에서 터미널을 열면 이미 이 폴더일 수 있습니다.)

---

## 2. GitHub에서 최신 내용 가져오기

```bash
git fetch origin
```

```bash
git pull origin main
```

**한 줄로 실행하려면:**

```bash
git fetch origin && git pull origin main
```

---

## 3. 요약

| 단계 | 명령 |
|------|------|
| 원격 최신 정보 가져오기 | `git fetch origin` |
| main 브랜치를 최신으로 맞추기 | `git pull origin main` |

- **저장소 주소**: https://github.com/byh3071-cpu/NotionUIUX.git  
- **기본 브랜치**: `main`

로컬에 커밋하지 않은 변경이 있으면 `git pull` 전에 먼저 `git stash`로 임시 저장하거나, 변경을 커밋한 뒤 pull 하세요.
