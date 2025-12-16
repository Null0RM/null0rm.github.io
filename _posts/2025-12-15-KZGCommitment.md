---
title: KZG Commitment - How Crypto Saved Ethereum's DA?
date: 2025-12-15 15:00:00 +0900
math: true
---

# ---------------- 미완성(작업 환경 이슈로 테스트 못하고 직접 박으면서 봐야합니다) -----------------

Ethereum이 Rollup 생태계를 본격화하면서 Data Availability(DA) 문제가 드러났다. 
L2 Rollup은 L1 블록의 calldata를 읽어 상태 전이를 검증하는데, 블록당 calldata의 용량이 증가하고 거래 처리량이 늘어나면서, light client는 물론 full node에게도 데이터 저장 및 처리 부담이 커져 확장성 문제가 심화되었다.

이 상태로는 모든 Rollup이 full node에 의존할 수 밖에 없었기 때문에, 이를 해결하기 위한 EIP-4844가 제안되었다. 

# Blob 
EIP-4844가 도입되면서, 새로운 트랜잭션 타입 `0x03`을 지정받은 `Blob-carrying Transaction (Blob TX)`이 등장했다.

`Blob`은 **L2 롤업의 데이터를 담기 위해 설계된, 기존 `calldata`보다 훨씬 저렴한 임시 저장(Ephemeral Storage) 공간이자 데이터 구조**라고 할 수 있다.

또한 **이더리움 consensus 노드(Beacon Chain Node)**는 **`KZG Commitment`**를 통해, Blob 데이터 자체를 직접 다운로드하고 처리하지 않고도, 해당 데이터의 유효성 및 가용성(Data Availability, DA)을 암호학적으로 효율적으로 검증할 수 있다. 

이번 글에서는 L2의 Rollup data가 KZG Commitment Scheme을 통해 어떻게 L1까지 도달하고, 검증받게되는지 그 과정을 다뤄볼 생각이다. 

# Commit by KZG Commitment

**notation**
- $\mathbb{F}_q$: BLS12-381 Scalar Field
- $G_1$: BLS12-381 $G_1$ Group (48 bytes)
- $G_2$: BLS12-381 $G_2$ Group (96 bytes)
- $e$: Pairing e: $G_1 \times G_2 \rightarrow G_T$
- $\omega$: 4096th root of unity $\in \mathbb{F}_q$
- $\tau$: trusted setup에서 선택된 secret $\in \mathbb{F}_q$

## 1. Rollup data -> Polynomial 
L2 Sequencer는 우선 처음으로, blob에 넣을 rollup data를 Polynomial로 표현한다. 
data의 종류는 rollup의 종류마다 다른데, 대표적으로 아래와 같다고 보면 된다. 
- Optimism: Compressed tx batch
- ZKSync: State delta + proof
- Arbitrum: State root 변화 record
=> 128KB data

이러한 rollup 데이터 131072바이트는 32바이트 청크 4096개로 분할되며, 각 청크는 $\mathbb{F}_q$의 원소로 변환된다.

$$
\begin{aligned}
b_0 &= bytes[0:32] \pmod q \\
b_1 &= bytes[32:64] \pmod q \\
&...\\
b_{4095} &= bytes[130048:131072] \pmod q\\
\\
\rightarrow Blob &= [b_0,b_1,...,b_{4095}] \in \mathbb{F}_q^{4096}
\end{aligned}
$$

이제 각 Blob element들을 Polynomial에 매핑시켜주기 위해 아래 과정을 거쳐준다. 

$$
\begin{aligned}
P(\omega^0) &= b_0\\
P(\omega^1) &= b_1\\
&...\\
P(\omega^{4095}) &= b_{4095}
\end{aligned}
$$

즉, 구하고자 하는 $P(x)$는 4096개의 특정한 점, 즉 유한체 상의 4096차 근 $\omega^i$ (i=0,1,...,4095)에서 Blob data $b_i$의 값을 가지도록 Interpolation된다.

이렇게 관계가 만들어졌으면, 이를 바탕으로 4096개의 point를 통과하는 차수가 4095 이하인 다항식 $P(x)$가 유일하게 결정된다. 

아래와 같이 표현할 수 있다. 

$$
P(x) = \sum_{i=0}^{4095}c_ix^i
$$

## 2. Define Lagrange Interpolation Polynomial
Lagrange InterPolation Polynomial을 정의해주는 이유는 보통 한 가지이다. 풀어보면 다음과 같은데, 

$$
L_j(x)=\prod_{k=0, k \neq j}^{4095}\frac{x-\omega^k}{\omega^j-\omega^k}
$$

이는 각 $j$에 대해 $j$번째 점에서만 1, 나머지 점에서는 0이 되는 basis 다항식이라고 해석할 수 있다. 
즉, 

$$
\begin{aligned}
L_j(\omega^m)=1 \quad &\text{if } j=m\\
L_j(\omega^m)=0 \quad &\text{if } j\neq m
\end{aligned}
$$

## 3. Reconstruct P(x) by Lagrang Basis
이제 앞서 정의했던 다항식 $P(x)$를 새롭게 정의한 Domain인 $L_j(x)$를 바탕으로 다시 정의해보자. 

$$
P(x)=\sum_{j=0}^{4095}P(\omega^j)\cdot L_j(x)
$$

이는 다시, 아래와 같이 정의된다. 

$$
P(x)=\sum_{j=0}^{4095}b_j\cdot L_j(x)
$$

하지만 L2 Sequencer는 Polynomial 전체를 L1에 제출하는 대신, Polynomial의 특정 지점에서의 Evaluation(값)을 암호화하여 Commitment를 생성한다. 이 Commitment는 Polynomial $P(x)$ 자체를 간결하게 대변하는 역할을 하며, 이것이 바로 KZG Commitment의 핵심이 된다.

이 Commitment를 생성하는 데 사용되는 Evaluation Point은 Trusted Setup을 통해 미리 선택된 secret 값 $\tau$ 이다. 

이를 이용해보면, 
특별한 point $x = \tau$ 에서:

$$
\begin{aligned}
P(\tau) &= \sum_{j=0}^{4095}b_j\cdot L_j(\tau)\\
L_j(\tau) &= \prod_{k=0, k \neq j}^{4095}\frac{\tau-\omega^k}{\omega^j-\omega^k} \in \mathbb{F}_q
\end{aligned}
$$

($L_j(\tau)$는 상수: $\tau$가 고정되어있어 미리 계산 가능.)

## 4. Trusted Setup -> Group Element
Trusted setup 단계에서는 $\tau$의 거듭제곱에 대한 $G_1$원소 $(\tau^i\cdot G_1)$와 함께, Lagrange Basis Polynomial의 $\tau$에서의 evaluation에 대한 $G_1$원소 $L_j(\tau)\cdot G_1$를 미리 계산하여 배포한다.
이 값들이 검증을 위한 핵심 reference string이 되는 것이다. 

$$\rightarrow L_j(\tau)\cdot G_1 \text{ for j=0...4095}$$

## 5. KZG Commitment
드디어 마무리 단계이다. 앞서 힘들게 Lagrange Interpolation Polynomial을 정의해준 진가가 발휘되는 순간이다. 

$$
\begin{aligned}
\text{commitment } C &= \sum_{j=0}^{4095}b_j\cdot L_j(\tau)\cdot G_1 \\
&= P(\tau)\cdot G_1
\end{aligned}
$$

위 Lagrange Interpoation형태의 $P(x)$를 $\tau$ 지점에서 evaluate한 값 $P(\tau)$ 는 $G_1$ 그룹의 generator $G_1$ 에 곱해져 아래와 같이 commitment $C$로 표현된다. 

$$
C=P(\tau)\cdot G_1\in G_1
$$

이 과정을 통해 128KB의 rollup data를 단 48B 크기의 단일 $G_1$ 그룹 원소인 KZG Commitment $C$로 압축할 수 있다.

이를 코드로 나타내면 아래와 같다.

```python
computed_kzg = bls.Z1   # 0 · G₁ (영점)

for j, (value, point_kzg) in enumerate(zip(blob, KZG_SETUP_LAGRANGE)):
    # value = bⱼ ∈ F_BLS
    # point_kzg = Lⱼ(τ) · G₁
    temp = bls.multiply(point_kzg, value)     # bⱼ · [Lⱼ(τ) · G₁]
    computed_kzg = bls.add(computed_kzg, temp) # 누적 합

# 최종: C = P(τ) · G₁ (48 bytes)
```

# Opening the Commitment

앞선 과정을 통해 128KB에 달하는 거대한 rollup data를 단 48B의 $C$(commitment)로 압축했다. 
하지만, 검증자(L1 node) 입장에서는, 아래와 같은 의문이 들 수 있다. 
> "이 $C$가 정말 blob data로 만든게 맞아?

이로 인해, 다시 다음과 같은 질문을 할 수 있게 된다. 
> "이 blob의 $n$번째 데이터가 정말 $b_n$인지 증명해봐!

이 때 사용하는 것이 Opening, 즉 특정 지점에서의 값을 증명하는 것이다.
Opening과정에서는, 다항식 P(x)에 대해, 특정 지점 $z$에서의 값이 $y$임을 증명한다. 즉 $P(z) = y$.
이를 위해 학창시절에 열심히 배운 **다항식의 나머지 정리**를 활용한다!

$P(z)=y$라면, 다항식 $P(x)-y$는 $(x-z)$로 나눠 떨어져야 하기 때문에, 몫 다항식인 $Q(x)$가 존재하게 된다. 

$$
\begin{aligned}
P(x) -  y = (x - z)\cdot Q(x) \\
Q(x) = frac{P(x) - y}{x - z}
\end{aligned}
$$

Prover(L2 Sequencer)는 P(x)를 알고 있으므로, 직접 $Q(x)$를 유도할 수 있다. 그리고 이 $Q(x)$ 또한 Trusted setup의 $\tau$값을 이용해 Commitment로 만든다. 
이러한 과정을 통해 Proof $\pi$를 만들게 된다. 

$$
\pi = Q(\tau)\cdot G_1
$$

Prover는 이제 $(z,y,\pi)$ 를 Verifier에게 제출할 수 있다. 
> 자, point $z$에서 polynomial $P(x)$의 값은 $y$이고, 그 증거로 몫다항식의 commitment $\pi$를 줄게.

# Verification by Bilinear Pairing 
이제 Verifier(L1 node)의 차례다. Verifier는 $\tau$값을 모르지만, Bilinear Pairing (연산 e)를 활용하면 이를 몰라도 검증을 할 수 있다. 

KZG Commitment의 핵심 아이디어는 **암호화된 상태(타원곡선상)**에서 곱셈을 검증하는 것이다. 아래가 Verifier가 검증해야 할 등식이다. 

$$
P(\tau) - y \stackrel{?}{=} Q(\tau)\cdot (\tau - z)
$$ 

이를 Bilinear Pairing함수 $e: G_1 \times G_2 \rightarrow G_T$ 로 옮기면 다음과 같다:

$$
e(C-y\cdot G_1, G_2) \stackrel{?}{=} e(\pi, (\tau - z)\cdot G_2)
$$

이 식을 해석해보자.
1. 좌변: (Commitment $C$ - $y$)와 1(Generator $G_2$)를 곱(pairing)한다. $P(\tau) - y$ 와 같음.
2. 우변: proof $\pi$와 $\tau - z$를 곱한다. $Q(\tau)\cdot (\tau - z)$ 와 같음.

이 등식이 성립한다면, $\tau$를 몰라도 $P(z) - y$ 임을 암호학적으로 보장할 수 있는 것이다. 

**아래는 일련의 과정들을 표현한 시퀀스 도식이다.**

![KZG sequence](/assets/img/posts/2025-12-15-KZGCommitment/KZGCommitment_sequence.png "KZG sequence")