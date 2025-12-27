---
title: Proto-danksharding, eip-4844 & KZG Commitment
date: 2025-12-15 15:00:00 +0900
math: true
---

Ethereum이 Execution의 기능은 L2로 전이하고, L1은 DA와 Consensus에 집중한다 선언하며, Dencun 업데이트와 함께 EIP-4844가 온보딩되었다. 
기존의 Rollup은 L1 node가 L2 sequencer/operator가 보낸 calldata를 검증하는데, 블록당 calldata의 용량이 증가하고 거래 처리량이 늘어나면서, full node에게도 데이터 저장 및 처리 부담이 커졌다. 

calldata는 full node가 영구적으로 저장해야하는 데이터이기에, 데이터 비용을 줄이고자, Blob 데이터 공간이라는 개념을 도입하였다. 

# Blob 
EIP-4844가 도입되면서, 새로운 트랜잭션 타입 `0x03`을 지정받은 `Blob-carrying Transaction (Blob TX)`이 등장했다.

`Blob`은 **L2 롤업의 데이터를 담기 위해 설계된, 기존 `calldata`보다 훨씬 저렴한 임시 저장 공간**라고 할 수 있다.

또한 **이더리움 consensus 노드(Beacon Chain)**는 **`KZG Commitment`**를 통해, Blob 데이터 자체를 직접 다운로드하고 처리하지 않고도, 해당 데이터의 유효성을 값싸게 검증할 수 있다. 

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

하지만, 점이 4096개면 4096개의 연립방정식을 풀어야 모든 계수($c_i$)를 구할 수 있어 매우 비효율적인 방식이라고 할 수 있다. 때문에, Lagrange Interplation Polynomial을 통해 polynomial의 계수를 구하지 않고 특정 point에서의 evaluation을 계산하는 것이 좋을 것 같다.

## 2. Lagrange Interpolation Polynomial
Lagrange Interplation Polynomial은 다음과 같이 구성되어있다.  

$$
L_j(x)=\prod_{k=0, k \neq j}^{4095}\frac{x-\omega^k}{\omega^j-\omega^k}
$$

이는 각 $j$에 대해 $j$번째 점에서만 1, 나머지 점에서는 0이 되는 basis 다항식이다.

$$
\begin{aligned}
L_j(\omega^m)=1 \quad &\text{if } j=m\\
L_j(\omega^m)=0 \quad &\text{if } j\neq m
\end{aligned}
$$

이를 이용하면 **(1)**에서 설명했던 Polynomial $P(x)$를 훨씬 쉽게 표현할 수 있다. 

## 3. Reconstruct P(x) by Lagrange Basis
$P(\omega^j)=b_j$ 라는 것을 기억하면서, Polynomial $P(x)$의 쉬운 예시를 한 번 들어보자. 

$$
\begin{aligned}
P(\omega^0) = 3 \\
P(\omega^1) = 5 \\
P(\omega^2) = 2 \\
\end{aligned}
...
$$

이렇게 표현되어있을 때, $L_j(x)$를 적용해주면, 

$$
P(x) = P(\omega^0)\cdot L_0(x)+P(\omega^1)\cdot L_1(x)+P(\omega^2)\cdot L_2(x)
$$

라는 것을 알 수 있다. 

이를 일반화하면, 아래와 같은 형태의 polynomial $P(x)$가 완성된다. 

$$
P(x)=\sum_{j=0}^{4095}P(\omega^j)\cdot L_j(x)
$$

이는 다시, 아래와 같이 정의된다. 

$$
P(x)=\sum_{j=0}^{4095}b_j\cdot L_j(x)
$$

## 4. Apply Trusted Setup
사실 $\tau$ 값을 생성하는 과정은 KZG Commitment의 가장 처음 시작 단계에 있지만, 서술상의 편의를 위해 이 단계에서 서술하도록 하겠다. 

L2 Sequencer는 Polynomial 전체를 L1에 제출하는 대신, Polynomial의 특정 지점에서의 Evaluation으로 Commitment를 생성한다. 이 Commitment는 Polynomial $P(x)$ 자체를 간결하게 대변하는 역할을 하며, 이게 바로 KZG Commitment의 핵심이 된다.

이 Commitment를 생성하는 데 사용되는 polynomial $P(x)$ 의 point $x$ 는 **Trusted Setup을 통해 미리 선택된 secret 값 $\tau$ 이다.**

이를 이용해보면, point $x = \tau$ 에서:

$$
\begin{aligned}
P(\tau) &= \sum_{j=0}^{4095}b_j\cdot L_j(\tau)\\
L_j(\tau) &= \prod_{k=0, k \neq j}^{4095}\frac{\tau-\omega^k}{\omega^j-\omega^k} \in \mathbb{F}_q
\end{aligned}
$$

($L_j(\tau)$는 상수: $\tau$가 고정되어있어 미리 계산 가능.)

Trusted Setup의 단계에서는, $\tau$의 거듭제곱에 대한 $G_1$원소 $(\tau^i\cdot G_1)$와 함께, Lagrange Basis Polynomial의 $\tau$에서의 evaluation에 대한 $G_1$원소 $L_j(\tau)\cdot G_1$를 미리 계산한다. 

$$
\text{setup }=L_j(\tau)\cdot G_1 \text{ for j=0...4095}
$$

즉, 위에서 계산한 $P(\tau) = \sum_{j=0}^{4095}b_j\cdot L_j(\tau)$ 는, 타원곡선상 계산을 위해 $G_1$이 곱해진 $P(\tau) = \sum_{j=0}^{4095}b_j\cdot L_j(\tau)\cdot G_1$ 이 맞는 표현이 된다. 

## 5. KZG Commitment
앞서 정의해준 polynomial을 통해, Commitment $C$를 생성해보자.

$$
C = \sum_{j=0}^{4095}b_j\cdot L_j(\tau)\cdot G_1
$$

정리하면, 

$$
C=P(\tau)\cdot G_1\in G_1
$$

이 과정을 통해 128KB의 rollup data를 단 48B 크기의 단일 $G_1$ 그룹 원소인 KZG Commitment $C$로 압축할 수 있다.

# Challenge

앞선 과정을 통해 128KB에 달하는 거대한 rollup data를 단 48B의 $C$(commitment)로 압축했다. 
하지만, 검증자(L1 node) 입장에서는, 아래와 같은 의문이 들 수 있다. 
> "이 $C$가 정말 blob data로 만든게 맞아?

이로 인해, 다시 다음과 같은 질문을 할 수 있게 된다. 
> "이 blob의 $n$번째 데이터가 정말 $b_n$인지 증명해봐!

이러한 증명의 과정을, 암호학적으로 Challenge라 부른다. 
Challenge과정에서는, 다항식 P(x)에 대해, 특정 지점 $z$에서의 값이 $y$임을 증명한다. 즉 $P(z) = y$.

이를 위해 학창시절에 열심히 배운 **다항식의 나머지 정리**를 활용한다!

$P(z)=y$라면, 다항식 $P(x)-y$는 $(x-z)$로 나눠 떨어져야 하기 때문에, 몫 다항식인 $Q(x)$가 존재하게 된다. 

$$
\begin{aligned}
P(x) -  y = (x - z)\cdot Q(x) \\
Q(x) = \frac{P(x) - y}{x - z}
\end{aligned}
$$

Prover(L2 Sequencer)는 P(x)를 알고 있으므로, 직접 $Q(x)$를 유도할 수 있다. 그리고 이 $Q(x)$ 또한 Trusted setup의 $\tau$값을 이용해 Commitment로 만든다. 
이러한 과정을 통해 Proof $\pi$를 만들게 된다. 

$$
\pi = Q(\tau)\cdot G_1
$$

Prover는 이제 $(z,y,\pi)$ 를 Verifier에게 제출할 수 있다. 
> 자, point $z$에서 polynomial $P(x)$의 값은 $y$이고, 그 증거로 몫다항식의 commitment인 proof $\pi$를 줄게.

# Verification
이제 Verifier(L1 node)의 차례다. Verifier는 $\tau$값을 모르지만, Bilinear Pairing ($e: G_1\times G_2 \rightarrow G_T$)를 활용하면 이를 몰라도 검증을 할 수 있다. 

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
2. 우변: proof $\pi$와 $\tau - z$를 곱(pairing)한다. $Q(\tau)\cdot (\tau - z)$ 와 같음.

이 등식이 성립한다면, verifier는 $\tau$를 몰라도 $P(z) - y$ 임을 암호학적으로 보장할 수 있는 것이다. 

**KZG Commitment 전체 과정.**

![KZG sequence](/assets/img/posts/2025-12-15-KZGCommitment/KZGCommitment_sequence.png "KZG sequence")